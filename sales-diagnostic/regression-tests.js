#!/usr/bin/env node
'use strict';

/**
 * Sales Diagnostic v2 regression runner.
 * Runs against the real <script> from index.html with a minimal DOM/localStorage mock.
 * No external dependencies.
 *
 * Usage:
 *   node sales-diagnostic/regression-tests.js
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
if (!match) throw new Error('index.html: script block not found');
const script = match[1];

function node(id) {
  id = id || '';
  const n = {
    id, hidden:false, disabled:false, textContent:'', innerHTML:'', value:'',
    className:'', style:{}, children:[], dataset:{},
    appendChild(x){ this.children.push(x); return x; },
    append(){ this.children.push.apply(this.children, arguments); },
    replaceChildren(){ this.children = Array.from(arguments); },
    remove(){}, after(...nodes){(this.afterNodes||=[]).push(...nodes);}, _events:{}, addEventListener(type,fn){(this._events[type]||=[]).push(fn);},
    setAttribute(k,v){ this[k]=v; },
    cloneNode(){ return node(id + '_clone'); },
    focus(){this.focused=true;},
    classList:{ add(){}, remove(){}, contains(){ return false; } }
  };
  n.content = { cloneNode(){ return node(id + '_content'); } };
  return n;
}

const nodes = new Map();
const documentMock = {
  body: node('body'),
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, node(id));
    return nodes.get(id);
  },
  createElement(tag) { return node(tag); }
};
const windowMock = {
  scrollTo(){}, confirm(){ return true; }, alert(){}, prompt(){ return ''; }
};
const memory = {};
const localStorageMock = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(memory,k) ? memory[k] : null; },
  setItem(k,v){ memory[k]=String(v); },
  removeItem(k){ delete memory[k]; }
};
const navigatorMock = { clipboard:{ writeText:async()=>{} } };

const diag = new Function(
  'document','window','localStorage','navigator',
  script + '\nreturn window.__diagTest;'
)(documentMock, windowMock, localStorageMock, navigatorMock);

if (!diag) throw new Error('window.__diagTest was not exposed');
const s = diag.state;

function reset(mode, answers, route) {
  mode = mode || 'full';
  answers = answers || {};
  route = route || [];
  s.mode = mode;
  s.diagnosticMode = mode;
  s.answers = Object.assign({}, answers);
  s.path = route.slice();
  s.index = 0;
  s.result = null;
  s.deepAdded = false;
  s.precisionExcludedZones = [];
  s.followupBase = null;
  s.activeExperiment = null;
  s.activeCycleId = null;
  s.scopeId = null;
  s.businessGoal = answers.scope_goal || null;
  s.diagnosticTarget = answers.scope_target || null;
}
function code(r){ return r && (r.primaryCode || r.code) || null; }

const tests = [];
function add(id, priority, group, run, allowed) {
  tests.push({id, priority, group, run, allowed});
}
function full(id, priority, answers, allowed) {
  add(id, priority, 'FULL', () => { reset('full',answers); return code(diag.diagnoseFull()); }, allowed);
}
function build(id, priority, answers, route, allowed, mode) {
  add(id, priority, (mode||'build').toUpperCase(), () => {
    reset(mode||'build',answers,route);
    return code(diag.diagnoseBuild());
  }, allowed);
}
function precision(id, priority, primaryCode, values, allowed) {
  add(id, priority, 'PRECISION', () => {
    reset('precision');
    return diag.precisionEvaluate(primaryCode,values).outcome;
  }, allowed);
}

/* FULL F01-F25 (F23 includes route assertion below). */
full('F01','P1',{scope_goal:'new_sales',gate_fulfillment:'never',gate_economics:'good',gate_capacity:'reserve',core_demand:'regular',core_access:'none',core_offer:'yes',core_fit:'yes',core_trust:'rare',core_conversion:'easy'},['ACCESS']);
full('F02','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'unstable',deep_a1:'yes',deep_a2:'views_down'},['DISTRIBUTION']);
full('F03','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'unstable',deep_a1:'yes',deep_a2:'responses_down',core_offer:'no'},['OFFER']);
full('F04','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_fit:'bad'},['FIT']);
full('F05','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_trust:'often'},['DECISION_GAP']);
full('F06','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_conversion:'hard'},['PURCHASE_FRICTION']);
full('F07','P1',{scope_model:'APPOINTMENT',scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_start:'losses',deep_s1:'some'},['START_FAILURE']);
full('F08','P1',{scope_model:'SUBSCRIPTION',scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_start:'problem',deep_s1:'few',deep_s2:'some'},['ACTIVATION_FAILURE']);
full('F09','P1',{scope_model:'SUBSCRIPTION',scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_start:'losses',deep_s1:'most',deep_s2:'rare'},['FIRST_VALUE_GAP']);
full('F10','P1',{gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no'},['FULFILLMENT']);
full('F11','P1',{gate_fulfillment:'regular',deep_f1:['overload'],deep_f2:'yes'},['CAPACITY']);
full('F12','P0',{scope_goal:'new_sales',gate_economics:'negative',gate_capacity:'reserve'},['ECONOMICS']);
full('F13','P0',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'limit'},['CAPACITY']);
full('F14','P1',{scope_goal:'repeat',core_repeat:'rare',deep_r1:'no'},['NO_CRITICAL_CONSTRAINT_FOUND']);
full('F15','P1',{scope_goal:'repeat',core_repeat:'rare',deep_r1:'yes',deep_r2:'sometimes',deep_r3:'no'},['CUSTOMER_MEMORY_GAP']);
full('F16','P1',{scope_goal:'income',gate_economics:'low',gate_capacity:'reserve',core_access:'unstable'},['ECONOMICS']);
full('F17','P1',{scope_goal:'overload',gate_capacity:'overload',core_access:'none'},['CAPACITY']);
full('F18','P1',{scope_goal:'new_sales',period_integrity:'closed',gate_economics:'good',gate_capacity:'reserve',core_access:'unstable',deep_a1:'yes'},['DATA_GAP']);
full('F19','P1',{scope_goal:'new_sales',period_integrity:'closed',gate_economics:'negative'},['ECONOMICS']);
full('F20','P1',{core_demand:'unknown',core_access:'unknown',core_repeat:'unknown',gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no'},['FULFILLMENT']);
full('F21','P1',{scope_goal:'new_sales',core_demand:'unknown',core_access:'unknown',gate_economics:'good',gate_capacity:'reserve'},['DATA_GAP']);
full('F22','P1',{scope_goal:'income',scope_target:'per_sale',gate_economics:'low',gate_capacity:'reserve'},['ECONOMICS']);
full('F23','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'none'},['ACCESS']);
full('F24','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'none',core_value:'yes',post_referral:'no'},['ACCESS']);
full('F25','P1',{scope_model:'SUBSCRIPTION',scope_goal:'repeat',scope_target:'reactivate_members',core_repeat:'often',post_reactivation:'many'},['REACTIVATION_GAP']);

/* Transition T01-T04 + geography timing. */
function routeAtMaturity(a) {
  reset('full',a,['scope_goal','scope_name','scope_model','scope_target','maturity_state']);
  s.index=4; diag.goNext();
}
add('T01','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'new_sales',scope_name:'X',scope_model:'PRODUCT',scope_target:'new_customers',maturity_state:'none'});return s.mode+'|'+s.businessGoal+'|'+s.path.includes('inheritance_entry');},['build|new_sales|true']);
add('T02','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'income',scope_name:'X',scope_model:'EXPERT',scope_target:'owner_money',maturity_state:'few'});return s.mode+'|'+s.businessGoal;},['build|income']);
add('T03','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'new_sales',scope_name:'X',scope_model:'PRODUCT',scope_target:'new_customers',maturity_state:'changed'});return s.mode+'|'+s.path.includes('inheritance_entry');},['hybrid|true']);
add('T04','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'income',scope_name:'X',scope_model:'EXPERT',scope_target:'owner_money',maturity_state:'none'});return s.businessGoal+'|'+s.diagnosticTarget;},['income|owner_money']);
add('F22-route','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'income',scope_name:'X',scope_model:'PRODUCT',scope_target:'per_sale',maturity_state:'repeatable'});return String(s.path.includes('scope_geography'));},['false']);
add('F23-route','P1','ROUTE',()=>{routeAtMaturity({scope_goal:'new_sales',scope_name:'X',scope_model:'PRODUCT',scope_target:'new_customers',maturity_state:'repeatable'});return String(s.path.includes('scope_geography'));},['false']);
add('F23-late-geography','P1','ROUTE',()=>{reset('full',{scope_goal:'new_sales',scope_model:'PRODUCT',gate_economics:'good',gate_capacity:'reserve',core_access:'none'},['core_access']);s.index=0;diag.goNext();return s.path.includes('scope_geography')?'LATE':'MISSING';},['LATE']);

/* BUILD B01-B16. */
const b={gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'yes',build_pilot_capacity:'yes',build_offer:'yes',build_route:'yes',build_access:'yes'};
build('B01','P1',Object.assign({},b,{build_market:'unknown'}),['build_econ_plausibility','build_pilot_capacity','build_offer','build_route','build_access','build_market'],['BUILD_MARKET_TEST']);
build('B02','P1',Object.assign({},b,{build_market:'unknown'}),['build_offer','build_route','build_access','build_market'],['BUILD_MARKET_TEST']);
build('B03','P1',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'yes'}),['build_offer','build_route','build_access','build_market'],['BUILD_DEMAND']);
build('B04','P1',Object.assign({},b,{build_market:'no',build_market_audience:'no',build_market_sample:30}),['build_offer','build_route','build_access','build_market'],['BUILD_MARKET_TEST']);
build('B05','P1',Object.assign({},b,{build_market:'paid',build_market_quality:'friend_support'}),['build_offer','build_route','build_access','build_market','build_market_quality'],['BUILD_MARKET_TEST','DATA_GAP']);
build('B06','P1',Object.assign({},b,{build_market:'paid',build_market_quality:'warm_existing'}),['build_offer','build_route','build_access','build_market','build_market_quality'],['BUILD_MARKET_TEST','BUILD_FULFILLMENT']);
build('B07','P1',Object.assign({},b,{build_market:'paid',build_market_quality:'target_normal'}),['build_offer','build_route','build_access','build_market','build_market_quality'],['BUILD_FULFILLMENT']);
build('B08','P1',Object.assign({},b,{build_offer:'no'}),['build_offer'],['BUILD_OFFER']);
build('B09','P1',Object.assign({},b,{build_route:'no'}),['build_offer','build_route'],['BUILD_ROUTE']);
build('B10','P1',Object.assign({},b,{build_access:'no'}),['build_offer','build_route','build_access'],['BUILD_ACCESS']);
build('B11','P1',Object.assign({},b,{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'yes',build_value:'yes',build_economics:'yes',build_capacity:'no'}),['build_offer','build_route','build_access','build_market','build_market_quality','build_fulfillment','build_value','build_economics','build_capacity'],['BUILD_CAPACITY']);
build('B12','P0',{gate_legal:'no',build_test_type:'payment',build_pilot_capacity:'no'},['build_pilot_capacity'],['BUILD_CAPACITY']);
build('B13','P0',{gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'no'},['build_econ_plausibility'],['BUILD_ECONOMICS']);
build('B14','P1',{gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'unknown'},['build_econ_plausibility'],['BUILD_ECONOMICS','BUILD_MARKET_TEST']);
build('B15','P0',{gate_legal:'unknown',build_test_type:'payment'},['gate_legal'],['LEGAL_SAFETY_BLOCKER']);
add('B15-route','P0','BUILD',()=>{
  reset('build',{gate_legal:'unknown',build_test_type:'payment'},['gate_legal','build_econ_plausibility']);
  s.index=0; diag.goNext();
  return code(s.result);
},['LEGAL_SAFETY_BLOCKER']);
add('B16','P1','BUILD',()=>{reset('build',{gate_legal:'unknown',build_test_type:'research'});return String(diag.legalBlocksCurrentAction(s.answers,s.mode));},['false']);
add('B16-route','P1','BUILD',()=>{
  reset('build',{gate_legal:'unknown',build_test_type:'research'},['gate_legal','build_econ_plausibility']);
  s.index=0; diag.goNext();
  return (code(s.result)||'NONE')+'|'+s.path[s.index];
},['NONE|build_econ_plausibility']);

/* HYBRID H01-H08. */
add('H01','P1','HYBRID',()=>{reset('hybrid',{scope_model:'PRODUCT'});const q=diag.questions.inheritance_map;const xs=q.optionsFn?q.optionsFn(s):q.options;return String(xs.some(o=>o.value==='none'));},['true']);
build('H02','P1',{gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'yes',build_offer:'yes',build_market:'unknown'},['build_econ_plausibility','build_offer','build_market'],['BUILD_MARKET_TEST'],'hybrid');
build('H03','P1',{gate_legal:'no',build_test_type:'payment',build_access:'no'},['build_access'],['BUILD_ACCESS'],'hybrid');
build('H04','P1',{gate_legal:'no',build_test_type:'payment',build_access:'yes',build_market:'unknown'},['build_access','build_market'],['BUILD_MARKET_TEST'],'hybrid');
build('H05','P1',{gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'yes',build_pilot_capacity:'yes',build_fulfillment:'issues'},['build_econ_plausibility','build_pilot_capacity','build_fulfillment','build_value'],['BUILD_FULFILLMENT'],'hybrid');
add('H06','P1','HYBRID',()=>{reset('hybrid',{scope_model:'PRODUCT',inheritance_map:['unknown']},['inheritance_map']);s.index=0;diag.goNext();return code(s.result);},['DATA_GAP']);
add('H07','P1','HYBRID',()=>{reset('hybrid',{build_test_type:'payment',inheritance_entry:'existing',inheritance_map:['offer'],shared_resources:['time'],shared_materiality:'no'});return String(diag.shouldAskSharedImpact(s));},['false']);
add('H08','P0','HYBRID',()=>{reset('hybrid',{build_test_type:'payment',inheritance_entry:'existing',inheritance_map:['capacity'],shared_resources:['time'],shared_materiality:'yes'});return String(diag.shouldAskSharedImpact(s));},['true']);

/* Precision P01-P07. */
precision('P01','P1','FIT',{p_comparable:'yes',p_inquiries:20,p_fit:20},['CONTRADICTED']);
precision('P02','P1','PURCHASE_FRICTION',{p_comparable:'yes',p_ready_to_buy:12,p_orders:12},['CONTRADICTED']);
precision('P03','P1','FULFILLMENT',{p_comparable:'yes',p_completed:30,p_problems:0},['CONTRADICTED']);
precision('P04','P0','ECONOMICS',{p_comparable:'yes',p_revenue:3000,p_direct_costs:3500,p_hours:2},['CONFIRMED']);
precision('P05','P1','DEMAND_WEAK',{p_comparable:'yes',p_market_people:0,p_market_actions:0,p_market_paid:0},['INSUFFICIENT_DENOMINATOR']);
precision('P06','P1','ACCESS',{p_comparable:'yes',p_inquiries:2,p_fit:2,p_orders:1},['WEAKENED']);
precision('P07','P1','CAPACITY',{p_comparable:'yes',p_current_volume:15,p_sustainable_volume:15,p_capacity_period:'week'},['CONFIRMED']);

/* Retention R01-R05. */
full('R01','P1',{scope_goal:'repeat',gate_fulfillment:'sometimes',core_value:'issues',post_recovery:'often_unresolved'},['RECOVERY_FAILURE']);
full('R02','P1',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_value:'yes',post_referral:'no'},['NO_CRITICAL_CONSTRAINT_FOUND']);
full('R03','P1',{scope_model:'SUBSCRIPTION',scope_goal:'repeat',scope_target:'renewals',core_repeat:'na'},['DATA_GAP','NO_CRITICAL_CONSTRAINT_FOUND']);
full('R04','P1',{scope_model:'SUBSCRIPTION',scope_goal:'repeat',scope_target:'renewals',core_repeat:'rare',sub_cancel_known:'yes',sub_cancel_reason:['no_value']},['VALUE_FAILURE']);
full('R05','P1',{scope_model:'SUBSCRIPTION',scope_goal:'repeat',scope_target:'reactivate_members',core_repeat:'rare',sub_cancel_known:'yes',sub_cancel_reason:['temporary'],post_reactivation:'many'},['REACTIVATION_GAP']);

/* Follow-up FU01-FU05 + extended lifecycle. */
function classify(ans,baseCode,baseAnswers){
  baseCode=baseCode||'ACCESS'; baseAnswers=baseAnswers||{};
  reset('followup',ans);
  s.followupBase={answers:baseAnswers,result:{primaryCode:baseCode,diagnosticMode:'full',dataGapBranches:baseCode==='DATA_GAP'?diag.dataGapBranchesFor(baseAnswers):null},experimentPlan:{primaryCode:baseCode}};
  return diag.classifyFollowup();
}
add('FU01','P1','FOLLOWUP',()=>classify({fu_done:'no'}).code,['FOLLOWUP_NOT_EXECUTED']);
add('FU02','P1','FOLLOWUP',()=>classify({fu_done:'primary_only',fu_execution_match:'no',fu_sample_ready:'not_yet'}).code,['FOLLOWUP_INSUFFICIENT_EVIDENCE']);
add('FU03','P1','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_guardrail:['none']}).code,['FOLLOWUP_CONFIRMED']);
add('FU04','P0','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_guardrail:['money']}).code,['FOLLOWUP_GUARDRAIL_FAIL']);
add('FU05','P1','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'no'}).code,['FOLLOWUP_INVALID_MEASUREMENT']);
add('FU06','P1','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'not_yet'}).outcome,['R0']);
add('FU07','P0','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_guardrail:['quality']}).outcome,['R-']);
add('FU08','P1','FOLLOWUP',()=>classify({fu_done:'yes',fu_execution_match:'several'}).outcome,['RX']);
add('FU09','P1','FOLLOWUP',()=>{const x=classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'cap'});return x.outcome+'|'+x.decision;},['R0|REDESIGN']);
function transition(prevCode,origin,cls,baseAnswers){
  baseAnswers=baseAnswers||{}; reset('followup',baseAnswers);
  s.followupBase={answers:baseAnswers,result:{primaryCode:prevCode,diagnosticMode:origin,dataGapBranches:prevCode==='DATA_GAP'?diag.dataGapBranchesFor(baseAnswers):null},experimentPlan:{primaryCode:prevCode}};
  return diag.buildStateTransition(cls);
}
add('FU10','P1','FOLLOWUP',()=>{const t=transition('ACCESS','full',{outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'},{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'none'});return t.toPrimaryCode;},['NO_CRITICAL_CONSTRAINT_FOUND',null]);
add('FU11','P1','FOLLOWUP',()=>{const t=transition('ACCESS','full',{outcome:'R-',decision:'REDESIGN',code:'FOLLOWUP_FAILED'});return t.type+'|'+t.toPrimaryCode;},['SAME_CONSTRAINT_NEW_INTERVENTION|ACCESS']);
add('FU12','P1','FOLLOWUP',()=>{const t=transition('BUILD_MARKET_TEST','build',{outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'});return t.type+'|'+t.toPrimaryCode;},['MARKET_INTEREST_ONLY|BUILD_MARKET_TEST']);
add('FU13','P1','FOLLOWUP',()=>{const base={scope_goal:'new_sales',core_demand:'unknown',core_access:'unknown',gate_economics:'good',gate_capacity:'reserve'};reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_data_gap_branch:'branch_0'});s.followupBase={answers:base,result:{primaryCode:'DATA_GAP',diagnosticMode:'full',dataGapBranches:diag.dataGapBranchesFor(base)},experimentPlan:{primaryCode:'DATA_GAP'}};const cl=diag.classifyFollowup();const t=diag.buildStateTransition(cl);return cl.code+'|'+t.toPrimaryCode;},['FOLLOWUP_REDIRECTED|ACCESS']);

/* Precision extension checks required by later architecture. */
precision('PX01-start-contradiction','P1','START_FAILURE',{p_comparable:'yes',p_confirmed:10,p_started:10},['CONTRADICTED']);
precision('PX02-first-value-contradiction','P1','FIRST_VALUE_GAP',{p_comparable:'yes',p_started:10,p_first_value:10},['CONTRADICTED']);
precision('PX03-value-zero','P1','VALUE_FAILURE',{p_comparable:'yes',p_value_total:0,p_value_problems:0},['INSUFFICIENT_DENOMINATOR']);
precision('PX04-repeat-zero','P1','NEXT_CYCLE',{p_comparable:'yes',p_repeat_eligible:0,p_repeat_returned:0},['INSUFFICIENT_DENOMINATOR']);
precision('PX05-renewal-zero','P1','SUB_RENEWAL',{p_comparable:'yes',p_renewal_due:0,p_renewed:0},['INSUFFICIENT_DENOMINATOR']);
precision('PX06-positive-contribution','P1','ECONOMICS',{p_comparable:'yes',p_revenue:5000,p_direct_costs:3000,p_hours:10},['WEAKENED']);
precision('PX07-capacity-reserve','P1','CAPACITY',{p_comparable:'yes',p_current_volume:10,p_sustainable_volume:15,p_capacity_period:'week'},['WEAKENED']);
precision('PX08-incomparable','P1','FIT',{p_comparable:'no',p_inquiries:20,p_fit:10},['INCOMPARABLE_DATA']);
precision('PX09-invalid-input','P1','FIT',{p_comparable:'yes',p_inquiries:10,p_fit:11},['INVALID_INPUT']);

/* History / Resume / invalidation contract. */
add('HIST01','P1','HISTORY',()=>String(diag.loadHistoryStore().schemaVersion),['2']);
add('HIST02','P1','HISTORY',()=>diag.cycleStatusLabel('ACTIVE'),['Проверка идёт']);
add('HIST03','P1','HISTORY',()=>diag.cycleStatusLabel('WAITING_FOR_EVIDENCE'),['Нужно ещё немного наблюдений']);
add('HIST04','P1','HISTORY',()=>String(html.includes('if (!cycle || isOpenCycleStatus(cycle.status)) return false')),['true']);
add('HIST05','P1','HISTORY',()=>String(html.includes('parentCycleId')&&html.includes('nextCycleId')),['true']);
add('HIST06','P1','HISTORY',()=>String(!html.includes('localStorage.removeItem(HISTORY_STORAGE_KEY)')),['true']);
add('BACK01','P1','UX',()=>String(html.includes('function invalidateDownstreamAnswers(fromIndex = state.index)')),['true']);
add('BACK02','P1','UX',()=>String(html.includes('if (previous !== state.answers[id]) invalidateDownstreamAnswers(state.index)')),['true']);
add('BACK03','P1','UX',()=>String(html.includes('if (previous !== JSON.stringify(state.answers[id])) invalidateDownstreamAnswers(state.index)')),['true']);

if (tests.length < 80) throw new Error('Regression coverage unexpectedly shrank: ' + tests.length);


/* Stage A: 35 additional simulated business-state checks.
 * These exercise the real decision engine but are NOT usability sessions.
 * They complement, not replace, owner-led browser testing.
 */
const simulatedFull = [
  ['A-F01',{scope_goal:'new_sales',gate_economics:'negative',gate_capacity:'limit',core_access:'none'},['ECONOMICS','CAPACITY']],
  ['A-F02',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'limit',core_access:'none'},['CAPACITY']],
  ['A-F03',{scope_goal:'new_sales',gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no',core_access:'none'},['FULFILLMENT']],
  ['A-F04',{scope_goal:'income',gate_fulfillment:'regular',deep_f1:['overload'],deep_f2:'yes',core_access:'none'},['CAPACITY']],
  ['A-F05',{scope_goal:'repeat',core_repeat:'rare',deep_r1:'no',core_access:'none'},['NO_CRITICAL_CONSTRAINT_FOUND']],
  ['A-F06',{scope_goal:'new_sales',period_integrity:'closed',gate_capacity:'limit',gate_economics:'good',core_access:'none'},['CAPACITY']],
  ['A-F07',{scope_goal:'new_sales',period_integrity:'closed',gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no',core_access:'none'},['FULFILLMENT']],
  ['A-F08',{scope_goal:'repeat',gate_economics:'negative',core_repeat:'rare',deep_r1:'yes'},['ECONOMICS']],
  ['A-F09',{scope_goal:'new_sales',gate_economics:'good',gate_capacity:'reserve',core_access:'none',post_reactivation:'many'},['ACCESS']],
  ['A-F10',{scope_goal:'new_sales',gate_economics:'negative',core_demand:'unknown',core_access:'unknown'},['ECONOMICS']]
];
for (const [id,answers,allowed] of simulatedFull) full(id,'P1',answers,allowed);

const simulatedBuildBase = {gate_legal:'no',build_test_type:'payment',build_econ_plausibility:'yes',build_pilot_capacity:'yes',build_offer:'yes',build_route:'yes',build_access:'yes'};
const simulatedBuild = [
  ['A-B01',{build_offer:'no',build_access:'no'},['build_offer','build_access'],'BUILD_OFFER'],
  ['A-B02',{build_route:'no',build_access:'no'},['build_route','build_access'],'BUILD_ROUTE'],
  ['A-B03',{build_pilot_capacity:'no',build_market:'unknown'},['build_pilot_capacity','build_market'],'BUILD_CAPACITY'],
  ['A-B04',{build_econ_plausibility:'no',build_route:'no'},['build_econ_plausibility','build_route'],'BUILD_ECONOMICS'],
  ['A-B05',{gate_legal:'unknown'},['gate_legal','build_offer'],'LEGAL_SAFETY_BLOCKER'],
  ['A-B06',{gate_legal:'yes'},['gate_legal','build_offer'],'LEGAL_SAFETY_BLOCKER'],
  ['A-B07',{build_market:'no',build_market_audience:'no',build_market_sample:3},['build_market'],'BUILD_MARKET_TEST'],
  ['A-B08',{build_market:'no',build_market_audience:'yes',build_market_sample:0},['build_market'],'BUILD_MARKET_TEST'],
  ['A-B09',{build_market:'paid',build_market_quality:'target_normal'},['build_market','build_market_quality'],'BUILD_FULFILLMENT'],
  ['A-B10',{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'issues'},['build_market','build_market_quality','build_fulfillment'],'BUILD_FULFILLMENT'],
  ['A-B11',{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'yes',build_value:'no'},['build_market','build_market_quality','build_fulfillment','build_value'],'BUILD_VALUE'],
  ['A-B12',{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'yes',build_value:'yes',build_economics:'no'},['build_market','build_market_quality','build_fulfillment','build_value','build_economics'],'BUILD_ECONOMICS'],
  ['A-B13',{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'yes',build_value:'yes',build_economics:'yes',build_capacity:'no'},['build_market','build_market_quality','build_fulfillment','build_value','build_economics','build_capacity'],'BUILD_CAPACITY'],
  ['A-B14',{build_market:'paid',build_market_quality:'friend_support'},['build_market','build_market_quality'],'BUILD_MARKET_TEST']
];
for (const [id,answers,route,expected] of simulatedBuild) build(id,'P1',Object.assign({},simulatedBuildBase,answers),route,[expected]);

const simulatedPrecision = [
  ['A-P01','FIT',{p_comparable:'yes',p_inquiries:5,p_fit:5},'CONTRADICTED'],
  ['A-P02','ECONOMICS',{p_comparable:'yes',p_revenue:200,p_direct_costs:250,p_hours:4},'CONFIRMED'],
  ['A-P03','FIRST_VALUE_GAP',{p_comparable:'yes',p_started:5,p_first_value:0},'SUPPORTED_NOT_PROVEN'],
  ['A-P04','FULFILLMENT',{p_comparable:'yes',p_completed:15,p_problems:0},'CONTRADICTED'],
  ['A-P05','CAPACITY',{p_comparable:'yes',p_current_volume:5,p_sustainable_volume:20,p_capacity_period:'week'},'WEAKENED'],
  ['A-P06','DEMAND_WEAK',{p_comparable:'yes',p_market_people:0,p_market_actions:0},'INSUFFICIENT_DENOMINATOR'],
  ['A-P07','ECONOMICS',{p_comparable:'yes',p_revenue:3000,p_direct_costs:2000,p_hours:10},'WEAKENED'],
  ['A-P08','START_FAILURE',{p_comparable:'yes',p_confirmed:5,p_started:5},'CONTRADICTED'],
  ['A-P09','FIT',{p_comparable:'yes',p_inquiries:0,p_fit:0},'INSUFFICIENT_DENOMINATOR'],
  ['A-P10','NEXT_CYCLE',{p_comparable:'yes',p_repeat_eligible:0,p_repeat_returned:0},'INSUFFICIENT_DENOMINATOR'],
  ['A-P11','FIRST_VALUE_GAP',{p_comparable:'yes',p_started:8,p_first_value:8},'CONTRADICTED']
];
for (const [id,primaryCode,values,expected] of simulatedPrecision) precision(id,'P1',primaryCode,values,[expected]);


/* Recheck: a zero-action BUILD market test must have completed an explicit
 * pre-planned observation rule; one person is not repeatable market evidence. */
build('RC-B17-one-person','P1',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:1,build_market_test_complete:'yes'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete'],['BUILD_MARKET_TEST']);
build('RC-B18-unfinished','P1',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'no'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete'],['BUILD_MARKET_TEST']);
build('RC-B19-unplanned','P1',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'unplanned'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete'],['BUILD_MARKET_TEST']);
build('RC-B20-adequate','P1',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'yes'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete'],['BUILD_DEMAND']);
add('RC-route-ask-completion','P1','ROUTE',()=>{
  reset('build',Object.assign({},b,{build_market:'no',build_market_sample:20,build_market_audience:'yes'}),['build_market','build_market_sample','build_market_audience']);
  s.index=2; diag.goNext();
  return s.path[s.index]+'|'+String(s.result===null);
},['build_market_test_complete|true']);
add('RC-route-one-early-stop','P1','ROUTE',()=>{
  reset('build',Object.assign({},b,{build_market:'no',build_market_sample:1,build_market_audience:'yes'}),['build_market','build_market_sample','build_market_audience']);
  s.index=2; diag.goNext();
  return code(s.result)+'|'+String(!s.path.includes('build_market_test_complete'));
},['BUILD_MARKET_TEST|true']);


/* Recheck: confidence must reflect evidence quality, not just diagnostic mode. */
add('RC-confidence-friend','P1','RESULT',()=>{
  reset('build',Object.assign({},b,{build_market:'paid',build_market_quality:'friend_support'}),['build_market','build_market_quality']);
  const r=diag.diagnoseBuild(); return code(r)+'|'+r.confidence;
},['BUILD_MARKET_TEST|PRELIMINARY']);
add('RC-confidence-untested','P1','RESULT',()=>{
  reset('build',Object.assign({},b,{build_market:'unknown'}),['build_market']);
  const r=diag.diagnoseBuild(); return code(r)+'|'+r.confidence;
},['BUILD_MARKET_TEST|PRELIMINARY']);
add('RC-confidence-paid-next-phase','P1','RESULT',()=>{
  reset('build',Object.assign({},b,{build_market:'paid',build_market_quality:'target_normal'}),['build_market','build_market_quality']);
  const r=diag.diagnoseBuild(); return code(r)+'|'+r.confidence;
},['BUILD_FULFILLMENT|PRELIMINARY']);
add('RC-confidence-market-complete','P1','RESULT',()=>{
  reset('build',Object.assign({},b,{build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'yes'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete']);
  const r=diag.diagnoseBuild(); return code(r)+'|'+r.confidence;
},['BUILD_DEMAND|MEDIUM']);
add('RC-history-persistence','P1','HISTORY',()=>{
  const before=diag.loadHistoryStore();
  try {
    const now='2026-10-08T10:00:00.000Z';
    const store={schemaVersion:2,cycles:[{cycleId:'probe-open',status:'ACTIVE',updatedAt:now},{cycleId:'probe-closed',status:'COMPLETED',updatedAt:now}],activeCycleIds:[],lastActiveCycleId:'probe-open'};
    if(!diag.writeHistoryStore(store))return 'WRITE_FAILED';
    const loaded=diag.loadHistoryStore();
    return loaded.cycles.length+'|'+loaded.activeCycleIds.length;
  } finally {diag.writeHistoryStore(before);}
},['2|1']);
add('RC-history-clear-closed','P1','HISTORY',()=>{
  const before=diag.loadHistoryStore();
  try {
    const now='2026-10-08T10:00:00.000Z';
    diag.writeHistoryStore({schemaVersion:2,cycles:[{cycleId:'probe-open',status:'ACTIVE',updatedAt:now},{cycleId:'probe-closed',status:'COMPLETED',updatedAt:now}],activeCycleIds:[],lastActiveCycleId:'probe-open'});
    if(!diag.clearClosedHistory()) return 'CLEAR_FAILED';
    return diag.loadHistoryStore().cycles.map(c=>c.cycleId).join(',');
  } finally {diag.writeHistoryStore(before);}
},['probe-open']);


/* Plain-language contract: inspect output of actual result/copy handlers. */
add('LANG01-build-demand','P1','LANGUAGE',()=>{
  reset('build',Object.assign({},b,{scope_name:'букеты',scope_model:'PRODUCT',build_market:'no',build_market_audience:'yes',build_market_sample:20,build_market_test_complete:'yes'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete']);
  const r=diag.diagnoseBuild();r.experimentPlan=diag.experimentPlanFor(r);
  const txt=diag.resultText(r)+' '+r.experimentPlan.inconclusiveRule+' '+r.experimentPlan.invalidRule;
  return String(!/market.test|Observation rule|\\bR0\\b|\\bRX\\b|downstream|bottleneck|decision fork|\\broute\\b/i.test(txt));
},['true']);
add('LANG02-questions','P1','LANGUAGE',()=>{
  const ids=['scope_name','build_test_type','build_market_sample','build_market_test_complete','build_market_quality'];
  return String(ids.every(id=>diag.questions[id] && !/market test|observation rule/i.test(String(diag.questions[id].title))));
},['true']);
add('LANG03-export','P1','LANGUAGE',()=>{
  reset('build',{build_market:'unknown',scope_name:'букеты',scope_model:'PRODUCT'});
  const r=diag.makeResult('BUILD_MARKET_TEST');r.experimentPlan=diag.experimentPlanFor(r);
  return String(!/Если проверка невалидна|Это R0|Это RX|Observation rule/.test(diag.resultText(r)));
},['true']);
add('LANG04-result-rules','P1','LANGUAGE',()=>{
  reset('build',{scope_name:'торты на заказ',scope_model:'PRODUCT',build_market:'no',build_market_sample:20,build_market_audience:'yes',build_market_test_complete:'yes'});
  const r=diag.makeResult('BUILD_DEMAND');
  return String(!/market test|\\bB3\\b|fulfillment|route/.test([r.action,r.observationRule,r.nextIfSuccess,r.nextIfFailure].join(' ')));
},['true']);


add('LANG05-build-demand-evidence','P1','LANGUAGE',()=>{
  reset('build',Object.assign({},b,{scope_name:'клубничные букеты',scope_model:'PRODUCT',build_market:'no',build_market_sample:20,build_market_audience:'yes',build_market_test_complete:'yes'}),['build_market','build_market_sample','build_market_audience','build_market_test_complete']);
  const r=diag.diagnoseBuild();
  return String(r.why.some(x=>x.includes('20') && x.includes('Количество людей')) && r.why.some(x=>x.includes('причину отказов')) && !r.action.includes('реальный шаг'));
},['true']);
add('LANG06-build-untested-evidence','P1','LANGUAGE',()=>{
  reset('build',Object.assign({},b,{scope_name:'букеты',scope_model:'PRODUCT',build_market:'unknown'}),['build_market']);
  const r=diag.diagnoseBuild();
  return String(r.why.some(x=>x.includes('ещё не показали')));
},['true']);


add('LANG07-plain-questions-across-models','P1','LANGUAGE',()=>{
  const ids=['deep_cap1','shared_resources','shared_materiality','shared_impact','build_market_audience','p_market_people','p_market_actions','fu_sample_ready','fu_measurement_valid','deep_fit2'];
  return String(['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'].every(model=>{
    reset('build',{scope_model:model,scope_name:'товар',scope_goal:'new_sales'});
    return ids.every(id=>{
      const q=diag.questions[id];const str=typeof q.title==='function'?q.title(s):q.title;
      return !/на тех же ресурсах|общие ресурсы|какой ресурс|реальный шаг|условие наблюдения|по этим наблюдениям|важное ограничение/i.test(str);
    });
  }));
},['true']);


add('AUD-SAFETY-01','P0','SAFETY',()=>{
  reset('build',{scope_model:'PRODUCT',scope_name:'Съедобный букет',gate_legal:'unknown',build_test_type:'research',build_market:'unknown'});
  const r=diag.makeResult('BUILD_MARKET_TEST'),p=r.experimentPlan;
  return String(r.nonCommercialOnly===true && p.nonCommercialOnly===true && r.action.includes('Не принимайте') && p.executionSteps.some(x=>x.includes('Не принимайте')) && p.changeOneThing.includes('некоммерческие'));
},['true']);
add('AUD-SAFETY-02','P0','SAFETY',()=>{
  reset('build',{scope_model:'PRODUCT',gate_legal:'unknown',build_test_type:'payment',build_market:'unknown'});
  return code(diag.diagnoseBuild());
},['LEGAL_SAFETY_BLOCKER']);
add('AUD-BOOK-01','P1','BUILD',()=>{
  reset('build',{scope_model:'PRODUCT',gate_legal:'no',build_market:'reserved',build_offer:'yes',build_route:'yes',build_access:'yes'},['build_offer','build_route','build_access','build_market']);
  return code(diag.diagnoseBuild());
},['BUILD_MARKET_TEST']);
add('AUD-BACK-01','P1','ROUTE',()=>{
  reset('build',{build_market:'paid',gate_legal:'no',build_test_type:'research'},['build_offer','build_market','build_market_sample','build_market_audience','build_market_test_complete']);
  s.index=1;diag.invalidateDownstreamAnswers(1);diag.goNext();
  return String(s.path.includes('build_market_quality') && !s.path.includes('build_market_sample') && !s.path.includes('build_market_test_complete'));
},['true']);
add('AUD-ECON-01','P1','HYBRID',()=>{
  reset('hybrid',{scope_model:'PRODUCT',build_economics:'maybe'},['build_economics']);
  return code(diag.diagnoseBuild());
},['BUILD_ECONOMICS']);
add('AUD-EVID-01','P1','RESULT',()=>{
  reset('build',{scope_model:'PRODUCT',build_market:'no',build_market_sample:20,build_market_audience:'yes',build_market_test_complete:'yes'});
  const r=diag.makeResult('BUILD_DEMAND');
  return String(r.evidence.some(x=>x.questionId==='build_market_audience'&&x.value==='yes') && r.evidence.some(x=>x.questionId==='build_market_test_complete'&&x.value==='yes'));
},['true']);


add('AUD-FU-01','P1','FOLLOWUP',()=>{
  const x=classify({fu_done:'yes',fu_execution_match:'unknown',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_guardrail:['none']});
  return x.outcome+'|'+x.decision;
},['R0|REDESIGN']);
add('AUD-FU-02','P1','FOLLOWUP',()=>{
  const x=transition('BUILD_MARKET_TEST','build',{outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'}, {gate_legal:'no'});
  return x.type+'|'+x.toPrimaryCode;
},['MARKET_INTEREST_ONLY|BUILD_MARKET_TEST']);
add('AUD-FU-03','P1','FOLLOWUP',()=>{
  const x=transition('BUILD_MARKET_TEST','build',{outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'}, {gate_legal:'no'});
  s.answers.fu_market_payment='yes';
  const y=diag.buildStateTransition({outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'});
  return y.type+'|'+y.toPrimaryCode;
},['BUILD_PHASE_ADVANCED|BUILD_FULFILLMENT']);
add('AUD-FU-04','P0','FOLLOWUP',()=>{
  transition('BUILD_MARKET_TEST','build',{outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'}, {gate_legal:'unknown'});
  s.answers.fu_market_payment='yes';
  const y=diag.buildStateTransition({outcome:'R+',decision:'CONFIRM',code:'FOLLOWUP_CONFIRMED'});
  return y.toPrimaryCode;
},['LEGAL_SAFETY_BLOCKER']);
add('AUD-FU-05','P1','FOLLOWUP',()=>{
  reset('followup',{fu_effect:'better'});s.path=['fu_effect'];s.index=0;
  s.followupBase={result:{primaryCode:'BUILD_MARKET_TEST'},experimentPlan:{primaryCode:'BUILD_MARKET_TEST'}};
  diag.goNext();return s.path.join('|');
},['fu_effect|fu_market_payment']);
add('AUD-HIST-01','P1','HISTORY',()=>{
  reset('build',{scope_name:'Товар',scope_goal:'new_sales',build_market:'unknown'});
  s.scopeId='audit-history-' + Date.now();s.activeCycleId=null;
  const first={resultId:'original-audit',primaryCode:'BUILD_MARKET_TEST',userTitle:'Первый диагноз'};
  const save1=diag.saveHistory({mode:'build',scope:'Товар',answers:{scope_name:'Товар',build_market:'unknown'},result:first,cycleStatus:'ACTIVE'});
  const c=diag.loadHistoryStore().cycles.find(x=>x.result?.resultId==='original-audit');
  const save2=diag.saveHistory({cycleId:c.cycleId,mode:'followup',answers:{fu_done:'yes'},result:{resultId:'followup-audit',followup:true,followupSnapshot:{followupId:'fu-audit'},primaryCode:'BUILD_MARKET_TEST',userTitle:'Повторная проверка'},cycleStatus:'COMPLETED'});
  const stored=diag.loadHistoryStore().cycles.find(x=>x.cycleId===c.cycleId);
  return String(save1&&save2&&stored.initialDiagnosisSnapshot?.resultId==='original-audit'&&stored.initialAnswersSnapshot?.build_market==='unknown');
},['true']);


add('AUD-PREC-01','P1','PRECISION',()=>{
  reset('precision',{build_market_quality:'friend_support',gate_legal:'no',p_market_paid:1,p_market_actions:1});
  s.precisionOriginMode='build';
  return diag.precisionEvaluate('BUILD_MARKET_TEST',{p_comparable:'yes',p_market_people:10,p_market_actions:1,p_market_paid:1}).outcome;
},['CONTRADICTED']);
add('AUD-HYBRID-BACK-01','P1','ROUTE',()=>{
  reset('hybrid',{build_market_audience:'yes',build_market_sample:12},
    ['build_market','build_market_sample','build_market_audience','build_market_test_complete','build_fulfillment','build_value']);
  s.index=2;diag.invalidateDownstreamAnswers(2);
  return String(s.path.includes('build_fulfillment')&&!s.path.includes('build_market_test_complete'));
},['true']);


add('AUD-HYBRID-NONE-01','P1','HYBRID',()=>{
  reset('hybrid',{scope_model:'PRODUCT',inheritance_entry:'almost_all',inheritance_map:['none']},['inheritance_map']);
  diag.goNext();return String(!s.result&&s.path.includes('gate_legal')&&s.path.includes('build_market'));
},['true']);
add('AUD-HYBRID-SHARED-01','P0','HYBRID',()=>{
  reset('hybrid',{build_test_type:'payment',inheritance_entry:'almost_all',inheritance_map:['fulfillment']});
  return String(diag.shouldAskSharedResources(s));
},['true']);
add('AUD-HYBRID-SHARED-02','P1','HYBRID',()=>{
  reset('hybrid',{build_test_type:'research',inheritance_entry:'almost_all',inheritance_map:['fulfillment']});
  return String(diag.shouldAskSharedResources(s));
},['false']);


add('AUD-HIST-SELECT-01','P1','HISTORY',()=>{
  const now=new Date().toISOString();
  const mk=(id)=>({cycleId:id,scopeId:'scope-'+id,legacyReadonly:false,status:'ACTIVE',
    updatedAt:now,createdAt:now,scope:{name:id,diagnosticMode:'build'},answers:{scope_name:id},
    result:{primaryCode:'BUILD_MARKET_TEST',diagnosticMode:'build'},experimentPlan:{experimentId:'exp-'+id,primaryCode:'BUILD_MARKET_TEST'}});
  diag.writeHistoryStore({schemaVersion:2,cycles:[mk('audit-first'),mk('audit-second')],activeCycleIds:[],lastActiveCycleId:null});
  const ok=diag.startFollowupForCycle('audit-second');
  return String(ok && s.activeCycleId==='audit-second' && s.followupBase.cycleId==='audit-second' && s.path[0]==='fu_done');
},['true']);
add('AUD-HIST-SELECT-02','P1','HISTORY',()=>{
  return String(diag.startFollowupForCycle('no-such-cycle'));
},['false']);


add('AUD-UI-HIDDEN-01','P2','UX',()=>String(html.includes('[hidden] { display: none !important; }')),['true']);
add('AUD-UI-ARIA-01','P2','UX',()=>String(html.includes("input.setAttribute('aria-labelledby','questionTitle')")),['true']);
add('AUD-LANG-PREC-01','P2','LANGUAGE',()=>{
  reset('precision');
  const x=diag.precisionEvaluate('FIRST_VALUE_GAP',{p_comparable:'yes',p_started:5,p_first_value:5});
  return String(!/First Value Gap|Value\b|scope\/period\/route/i.test(x.message));
},['true']);


add('AUD-SAFETY-MATRIX','P0','SAFETY',()=>{
  const model=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
  return String(model.every(m=>['research','waitlist'].every(type=>['yes','maybe','unknown'].every(legal=>{
    reset('build',{scope_model:m,scope_name:'Товар',gate_legal:legal,build_test_type:type,build_market:'unknown'});
    const r=diag.makeResult('BUILD_MARKET_TEST');
    return r.nonCommercialOnly && r.experimentPlan?.nonCommercialOnly &&
      r.action.includes('Не принимайте') &&
      r.experimentPlan.executionSteps.some(x=>x.includes('Не принимайте'));
  }))));
},['true']);
add('AUD-PREC-FRIEND-REAL','P1','PRECISION',()=>{
  reset('precision',{scope_model:'PRODUCT',build_market_quality:'friend_support',gate_legal:'no',p_market_actions:1,p_market_paid:1});
  s.precisionOriginMode='build';
  return code(diag.reassessAfterPrecisionContradiction({primaryCode:'BUILD_MARKET_TEST'}, {outcome:'CONTRADICTED',message:'есть покупка знакомого'}));
},['BUILD_MARKET_TEST']);
add('AUD-FU-LEGAL-RESULT','P0','FOLLOWUP',()=>{
  reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_market_payment:'yes',fu_guardrail:['none']});
  s.followupBase={answers:{gate_legal:'unknown'},result:{primaryCode:'BUILD_MARKET_TEST',diagnosticMode:'build'},experimentPlan:{primaryCode:'BUILD_MARKET_TEST'}};
  const c=diag.classifyFollowup(),tran=diag.buildStateTransition(c);
  return String(tran.toPrimaryCode==='LEGAL_SAFETY_BLOCKER' && !/Продолжайте продажи/.test(tran.nextResult?.action||''));
},['true']);


add('AUD-EVID-PERIOD-SOURCE','P1','RESULT',()=>{
  reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',period_integrity:'closed',period_context:['peak'],core_access:'none'});
  const r=diag.makeResult('ACCESS');
  return String(r.evidence.some(e=>e.questionId==='period_integrity'&&e.value==='closed') &&
    r.evidence.some(e=>e.questionId==='period_context'&&e.value?.includes('peak')) &&
    r.evidence.some(e=>e.questionId==='core_access'&&e.value==='none'));
},['true']);
add('AUD-EVID-SKIP-SOURCE','P1','RESULT',()=>{
  reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',scope_target:'completed_orders'});
  const r=diag.makeResult('NO_CRITICAL_CONSTRAINT_FOUND');
  return String(r.evidence.every(e=>e.questionId===null && e.value===null && e.type==='INFERENCE'));
},['true']);
add('AUD-EVID-FIT-SOURCE','P1','RESULT',()=>{
  reset('full',{scope_model:'PRODUCT',core_fit:'bad',core_access:'none'});
  const r=diag.makeResult('FIT');
  return String(r.evidence.some(e=>e.questionId==='core_fit' && e.value==='bad') &&
    !r.evidence.some(e=>e.questionId==='core_access'));
},['true']);


/* Contract audit: 33 result codes with no answers must not invent observations. */
add('AUD-EVID-CONTRACT-33','P1','RESULT',()=>{
  const codes=Object.keys(diag.resultLibrary);
  return String(codes.length===33&&codes.every(id=>{
    reset(id.startsWith('BUILD_')?'build':'full',{scope_model:'PRODUCT',scope_name:'Подарки',scope_goal:'new_sales'});
    const r=diag.makeResult(id);
    return r.primaryCode===id&&r.confidence==='PRELIMINARY'&&
      r.evidence.every(e=>(e.questionId===null&&e.value===null&&e.type==='INFERENCE'))&&
      Array.isArray(r.metrics)&&typeof r.action==='string'&&
      !r.why.join(' ').includes('именно этот участок сейчас больше других влияет');
  }));
},['true']);
add('AUD-EVID-LEGAL-EXPLICIT','P1','RESULT',()=>{
  reset('full',{scope_model:'PRODUCT',gate_legal:'yes'});
  const r=diag.makeResult('LEGAL_SAFETY_BLOCKER');
  return r.confidence+'|'+String(r.evidence.some(e=>e.questionId==='gate_legal'&&e.value==='yes'));
},['MEDIUM|true']);
add('AUD-CONFIDENCE-QUALITATIVE','P1','RESULT',()=>{
  const cases=[
    ['FULFILLMENT',{gate_fulfillment:'regular',deep_f1:['deadline']}],
    ['FIT',{core_fit:'bad',deep_fit1:['budget']}],
    ['ECONOMICS',{gate_economics:'negative'}],
    ['RECOVERY_FAILURE',{post_recovery:'often_unresolved'}],
    ['SUB_RENEWAL',{core_repeat:'rare',sub_cancel_known:'yes',sub_cancel_reason:['no_value']}],
    ['CAPACITY',{gate_capacity:'overload',deep_cap1:'time',deep_cap2:'regular'}]
  ];
  return String(cases.every(([id,answers])=>{
    reset('full',Object.assign({scope_model:'PRODUCT'},answers));
    const r=diag.makeResult(id);
    return r.confidence!=='HIGH'&&r.evidence.every(e=>!e.questionId||e.value!==null);
  }));
},['true']);
add('AUD-EVID-DISTRIBUTION-ORIGIN','P1','RESULT',()=>{
  reset('full',{scope_model:'PRODUCT',core_access:'unstable',deep_a2:'views_down'});
  const r=diag.makeResult('DISTRIBUTION');
  return String(r.evidence.some(e=>e.questionId==='deep_a2'&&e.value==='views_down')&&
    r.evidence.some(e=>e.questionId==='core_access'&&e.value==='unstable'));
},['true']);
add('AUD-EVID-BUILD-NO-INVENTED-PAYMENT','P1','RESULT',()=>{
  reset('build',{scope_model:'PRODUCT',build_market:'reserved'});
  const r=diag.makeResult('BUILD_FULFILLMENT');
  return String(!r.why.join(' ').includes('первый заказ оплачен')&&
    !r.evidence.some(e=>e.questionId==='build_market'&&e.value==='paid'));
},['true']);


function auditRoute(mode, v) {
  diag.startMode(mode);
  const ids=[];
  for(let i=0;i<50&&!s.result;i++) {
    const id=s.path[s.index];ids.push(id);
    const q=diag.questions[id];
    if (!q) return {ids,result:'MISSING'};
    if(Object.prototype.hasOwnProperty.call(v,id))s.answers[id]=v[id];
    else { const opts=q.optionsFn?q.optionsFn(s):q.options;
      s.answers[id]=q.type==='multi'?[opts?.find(x=>x.value==='none')?.value||opts?.[0]?.value||'unknown']:
        q.type==='number'?1:opts?.find(x=>x.value==='unknown')?.value||opts?.[0]?.value||'test';
    }
    diag.goNext();
  }
  return {ids,result:s.result?.primaryCode};
}
add('AUD-ROUTE-RESEARCH-12','P2','ROUTE',()=>{
 const x=auditRoute('build',{scope_goal:'new_sales',scope_name:'Букеты',scope_model:'PRODUCT',
  scope_target:'completed_orders',maturity_state:'none',inheritance_entry:'none',
  build_test_type:'research',gate_legal:'unknown',build_offer:'yes',build_access:'yes',build_market:'unknown'});
 return x.ids.length+'|'+x.result+'|'+String(['build_econ_plausibility','build_pilot_capacity',
    'build_route','build_market_context'].every(id=>!x.ids.includes(id)));
},['11|BUILD_MARKET_TEST|true']);
add('AUD-ROUTE-RESEARCH-NO-DEMAND','P1','BUILD',()=>{
 reset('build',{scope_model:'PRODUCT',build_test_type:'research',gate_legal:'no',build_market:'no',
  build_market_sample:30,build_market_audience:'yes',build_market_test_complete:'yes'},
  ['build_market','build_market_sample','build_market_audience','build_market_test_complete']);
 return code(diag.diagnoseBuild())+'|'+diag.buildEarlyResult('build_market_test_complete');
},['BUILD_MARKET_TEST|BUILD_MARKET_TEST']);
add('AUD-ROUTE-FULL-18','P2','ROUTE',()=>{
 const x=auditRoute('full',{scope_goal:'new_sales',scope_name:'Торты',scope_model:'PRODUCT',
  scope_target:'new_customers',maturity_state:'repeatable',scope_period:'month',
  period_integrity:'normal',gate_legal:'no',gate_fulfillment:'never',gate_capacity:'reserve',
  gate_economics:'good',core_demand:'regular',core_access:'none',core_offer:'yes',
  deep_a1:'yes',deep_a2:'no_decline',deep_a4:['social']});
 return x.ids.length+'|'+x.result+'|'+String(['scope_route','period_context','core_fit',
    'core_trust','core_conversion','deep_a3'].every(id=>!x.ids.includes(id)));
},['18|ACCESS|true']);
add('AUD-ROUTE-DYNAMIC-CONTEXT','P2','ROUTE',()=>{
 const x=auditRoute('full',{scope_goal:'new_sales',scope_name:'Торты',scope_model:'PRODUCT',
  scope_target:'new_customers',maturity_state:'repeatable',scope_period:'month',
  period_integrity:'normal',gate_legal:'no',gate_fulfillment:'never',gate_capacity:'reserve',
  gate_economics:'good',core_demand:'regular',core_access:'unstable',core_offer:'yes',
  core_fit:'yes',core_trust:'rare',core_conversion:'easy',deep_a1:'yes',
  deep_a2:'views_down',deep_a4:['social']});
 return String(x.ids.includes('period_context')&&x.ids.indexOf('period_context')>x.ids.indexOf('deep_a2'));
},['true']);


add('AUD-ROUTE-BACK-RESTORE-PAID','P0','ROUTE',()=>{
  reset('build',{scope_model:'PRODUCT',build_test_type:'payment',gate_legal:'no'},
    ['build_test_type','gate_legal','build_offer','build_access','build_market']);
  s.index=0;diag.goNext();
  return String(['build_econ_plausibility','build_pilot_capacity','build_route']
    .every(x=>s.path.includes(x)) && s.path[1]==='gate_legal');
},['true']);
add('AUD-ROUTE-BACK-SKIP-NONCOMMERCIAL','P1','ROUTE',()=>{
  reset('build',{scope_model:'PRODUCT',build_test_type:'research',gate_legal:'unknown'},
    ['build_test_type','gate_legal','build_econ_plausibility','build_pilot_capacity',
      'build_offer','build_route','build_access','build_market_context','build_market']);
  s.index=0;diag.goNext();
  return String(['build_econ_plausibility','build_pilot_capacity','build_route','build_market_context']
    .every(x=>!s.path.includes(x))&&s.path[1]==='gate_legal');
},['true']);


const POPULATED_33={
 LEGAL_SAFETY_BLOCKER:{gate_legal:'yes'},DATA_GAP:{core_access:'unknown',core_demand:'unknown'},
 DEMAND_WEAK:{core_demand:'rare',deep_d1:'no',deep_d2:'few_requests',deep_d3:'no'},
 DEMAND_UNCLEAR:{core_demand:'unknown',core_access:'unknown'},
 OFFER:{core_offer:'no',deep_o1:['price','deadline']},
 FIT:{core_fit:'bad',deep_fit1:['budget','deadline']},
 ACCESS:{core_access:'none',core_demand:'regular',deep_a1:'yes',deep_a2:'no_decline',deep_a4:['social']},
 DISTRIBUTION:{core_access:'unstable',deep_a2:'views_down',deep_a1:'yes'},
 DECISION_GAP:{core_trust:'often',deep_t1:['price']},
 PURCHASE_FRICTION:{core_conversion:'breaks',deep_c1:['payment']},
 START_FAILURE:{core_start:'losses',deep_s1:'many'},
 ACTIVATION_FAILURE:{core_start:'losses',deep_s1:'few',deep_s2:'rare'},
 FIRST_VALUE_GAP:{core_start:'losses',deep_s1:'most',deep_s2:'rare'},
 FULFILLMENT:{gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no'},
 VALUE_FAILURE:{core_value:'issues',deep_v2:'yes',deep_v3:'quality'},
 NEXT_CYCLE:{core_repeat:'rare',deep_r1:'yes',deep_r2:'sometimes'},
 CUSTOMER_MEMORY_GAP:{core_repeat:'rare',deep_r1:'yes',deep_r2:'sometimes',deep_r3:'no'},
 RECOVERY_FAILURE:{post_recovery:'often_unresolved'},
 SUB_RENEWAL:{core_repeat:'rare',sub_cancel_known:'yes',sub_cancel_reason:['technical']},
 ADVOCACY_GAP:{post_referral:'no'},REACTIVATION_GAP:{post_reactivation:'many'},
 ECONOMICS:{gate_economics:'negative',deep_e1:'yes'},
 CAPACITY:{gate_capacity:'overload',deep_cap1:'time',deep_cap2:'regular'},
 BUILD_DEMAND:{build_market:'no',build_market_sample:20,build_market_audience:'yes',
  build_market_test_complete:'yes',build_test_type:'payment'},
 BUILD_OFFER:{build_offer:'no'},BUILD_ROUTE:{build_route:'no'},BUILD_ACCESS:{build_access:'no'},
 BUILD_MARKET_TEST:{build_market:'reserved',build_market_quality:'warm_existing',build_test_type:'preorder'},
 BUILD_FULFILLMENT:{build_market:'paid',build_market_quality:'target_normal',build_fulfillment:'no'},
 BUILD_VALUE:{build_market:'paid',build_value:'no'},
 BUILD_ECONOMICS:{build_econ_plausibility:'no',build_test_type:'payment'},
 BUILD_CAPACITY:{build_pilot_capacity:'no',build_test_type:'payment'},
 NO_CRITICAL_CONSTRAINT_FOUND:{gate_fulfillment:'never',gate_capacity:'reserve',gate_economics:'good',core_access:'regular'}
};
for(const [resultCode,caseAnswers] of Object.entries(POPULATED_33)){
 add('POP-'+resultCode,'P1','EVIDENCE',()=>{
  const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
  return String(models.every(model=>{
   reset(resultCode.startsWith('BUILD_')?'build':'full',{scope_model:model,scope_goal:'new_sales',...caseAnswers});
   const result=diag.makeResult(resultCode);
   return result.primaryCode===resultCode && result.confidence!=='HIGH' &&
     result.why.length>=1 && result.why.length<=4 &&
     result.evidence.every(e=>(!e.questionId || JSON.stringify(e.value)===JSON.stringify(s.answers[e.questionId]))) &&
     result.evidence.every(e=>e.questionId||e.type==='INFERENCE') &&
     result.evidence.every(e=>e.type!=='UNKNOWN'||(s.answers[e.questionId]==='unknown')) &&
     result.why.every(x=>typeof x==='string'&&!x.includes('undefined')) &&
     !result.why.some(x=>/\b(?:confidence|evidence|fulfillment|capacity)\b/i.test(x));
  }));
 },['true']);
}
add('POP-NO-CONFIDENT-UNKNOWN','P1','EVIDENCE',()=>{
 reset('full',{scope_model:'PRODUCT',core_access:'unknown',core_demand:'unknown'});
 const r=diag.makeResult('DATA_GAP');
 return r.confidence+'|'+String(r.evidence.every(e=>e.type==='UNKNOWN'||e.type==='INFERENCE'));
},['PRELIMINARY|true']);
add('POP-NO-FAKE-RENEWALS','P1','EVIDENCE',()=>{
 reset('full',{scope_model:'SUBSCRIPTION',core_repeat:'rare',sub_cancel_reason:['technical']});
 const r=diag.makeResult('SUB_RENEWAL');
 return String(!r.why.join(' ').includes('Участники доходят до срока') &&
    r.why.join(' ').includes('срок продления') &&
    r.evidence.some(e=>e.questionId==='sub_cancel_reason'));
},['true']);
add('POP-DETAIL-REAL-SOURCE','P1','EVIDENCE',()=>{
 reset('full',{scope_model:'PRODUCT',core_offer:'no',deep_o1:['price','deadline']});
 const r=diag.makeResult('OFFER');
 return String(r.why.length===2&&r.evidence.some(e=>e.questionId==='deep_o1'&&
    JSON.stringify(e.value)==='["price","deadline"]'));
},['true']);


add('NUM-ROUTE-PRESENT','P1','FOLLOWUP',()=>{
 reset('followup',{fu_measurement_valid:'yes'});
 s.path=['fu_measurement_valid'];s.index=0;
 s.followupBase={result:{primaryCode:'FULFILLMENT'},experimentPlan:{primaryCode:'FULFILLMENT',primaryMetricBefore:5,primaryMetricDenominatorBefore:10}};
 diag.goNext();const next=s.path[1];s.answers.fu_numeric_after=2;diag.goNext();
 return next+'|'+s.path[2];
},['fu_numeric_after|fu_numeric_denominator_after']);
add('NUM-ROUTE-LEGACY','P1','FOLLOWUP',()=>{
 reset('followup',{fu_measurement_valid:'yes'});s.path=['fu_measurement_valid'];
 s.followupBase={result:{primaryCode:'FULFILLMENT'},experimentPlan:{primaryCode:'FULFILLMENT'}};
 diag.goNext();return s.path[1];
},['fu_effect']);
add('NUM-LESS-IS-BETTER','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
  fu_measurement_valid:'yes',fu_numeric_after:2,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},experimentPlan:{primaryCode:'FULFILLMENT',primaryMetricBefore:5,primaryMetricDenominatorBefore:10}};
 return diag.followupNumericComparison().movement+'|'+diag.classifyFollowup().code;
},['better|FOLLOWUP_CONFIRMED']);
add('NUM-BETTER-CONTRADICTS','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
  fu_measurement_valid:'yes',fu_numeric_after:7,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},experimentPlan:{primaryCode:'FULFILLMENT',primaryMetricBefore:5,primaryMetricDenominatorBefore:10}};
 return diag.classifyFollowup().outcome+'|'+diag.classifyFollowup().code;
},['R0|FOLLOWUP_INSUFFICIENT_EVIDENCE']);
add('NUM-GUARDRAIL-PREVAILS','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
  fu_measurement_valid:'yes',fu_numeric_after:2,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['money']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},experimentPlan:{primaryCode:'FULFILLMENT',primaryMetricBefore:5,primaryMetricDenominatorBefore:10}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_GUARDRAIL_FAIL']);
add('NUM-SNAPSHOT-TRUTH','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
  fu_measurement_valid:'yes',fu_numeric_after:2,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT',diagnosticMode:'full',userTitle:'Сбои'},
  experimentPlan:{primaryCode:'FULFILLMENT',primaryMetricBefore:5,primaryMetricDenominatorBefore:10}};
 diag.finalizeFollowup();
 const f=s.result.followupSnapshot;
 return f.primaryMetricBefore+'|'+f.primaryMetricAfter+'|'+f.primaryMetricDelta+'|'+
  String(s.result.evidence.some(e=>e.questionId==='fu_numeric_after'&&e.value===2));
},['5|2|-3|true']);


/* Metamorphic diagnosis selection: a secondary contradiction must not
 * overturn an unrelated high-risk gate. Test real diagnoseFull(), not makeResult(). */
add('SEL-P0-ECON-OVER-OFFER-CONFLICT','P0','SELECTION',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
  reset('full',{scope_model:model,scope_goal:'new_sales',gate_legal:'no',
   gate_economics:'negative',gate_fulfillment:'never',gate_capacity:'reserve',
   core_offer:'no',deep_o1:['none'],deep_o2:'easy',core_access:'none'});
  return code(diag.diagnoseFull())==='ECONOMICS';
 }));
},['true']);
add('SEL-P0-FULFILL-OVER-OFFER-CONFLICT','P0','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',gate_fulfillment:'regular',
  gate_economics:'good',gate_capacity:'reserve',core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
 return code(diag.diagnoseFull());
},['FULFILLMENT']);
add('SEL-P0-CAP-OVER-TRUST-CONFLICT','P0','SELECTION',()=>{
 reset('full',{scope_model:'EXPERT',scope_goal:'new_sales',gate_capacity:'overload',
  gate_economics:'good',core_trust:'often',deep_t1:['none'],deep_t2:'yes'});
 return code(diag.diagnoseFull());
},['CAPACITY']);
add('SEL-P0-FULFILL-DISPUTED-ECON-VALID','P0','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',gate_fulfillment:'regular',
  deep_f1:['none'],deep_f2:'no',gate_economics:'negative',gate_capacity:'reserve'});
 return code(diag.diagnoseFull());
},['ECONOMICS']);
add('SEL-P1-ECON-SELF-CONFLICT','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',gate_economics:'negative',deep_e1:'no',
  deep_e2:'yes',deep_e3:['none'],gate_capacity:'reserve',gate_fulfillment:'never'});
 return code(diag.diagnoseFull());
},['DATA_GAP']);
add('SEL-P1-FULFILL-SELF-CONFLICT','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',gate_fulfillment:'regular',
  deep_f1:['none'],deep_f2:'no',gate_capacity:'reserve',gate_economics:'good'});
 return code(diag.diagnoseFull());
},['DATA_GAP']);
add('SEL-P0-LEGAL-STILL-FIRST','P0','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',gate_legal:'yes',gate_economics:'negative',
  gate_fulfillment:'regular',core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
 return code(diag.diagnoseFull());
},['LEGAL_SAFETY_BLOCKER']);
add('SEL-P0-HARD-OVERRIDES-PERIOD','P0','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',period_integrity:'absence',
  gate_capacity:'overload',gate_economics:'good',core_access:'none'});
 return code(diag.diagnoseFull());
},['CAPACITY']);
add('SEL-P1-FIT-BEATS-CONVERSION-UNKNOWN','P1','SELECTION',()=>{
 reset('full',{scope_model:'APPOINTMENT',scope_goal:'new_sales',gate_economics:'good',
 gate_capacity:'reserve',core_fit:'bad',core_conversion:'unknown',core_access:'regular'});
 return code(diag.diagnoseFull());
},['FIT']);
add('SEL-P1-PAID-DEMAND-IS-NOT-ZERO','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',gate_economics:'good',
 gate_capacity:'reserve',core_demand:'rare',core_access:'none',deep_d1:'yes'});
 return code(diag.diagnoseFull());
},['ACCESS']);
add('SEL-P0-BUILD-RESEARCH-ZERO-NOT-WEAK','P0','SELECTION',()=>{
 reset('build',{scope_model:'PRODUCT',build_test_type:'research',gate_legal:'unknown',
  build_market:'no',build_market_sample:25,build_market_audience:'yes',build_market_test_complete:'yes'},
  ['build_market','build_market_sample','build_market_audience','build_market_test_complete']);
 return code(diag.diagnoseBuild());
},['BUILD_MARKET_TEST']);
add('SEL-P0-HYBRID-SHARED-CASH','P0','SELECTION',()=>{
 reset('hybrid',{scope_model:'PRODUCT',shared_impact:'cash',build_market:'paid'});
 return code(diag.diagnoseBuild());
},['ECONOMICS']);


add('RATE-COUNT-UP-RATE-WORSE','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',
   fu_numeric_after:3,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},
   experimentPlan:{primaryMetricBefore:5,primaryMetricDenominatorBefore:100}};
 return diag.followupNumericComparison().movement+'|'+diag.classifyFollowup().code;
},['worse|FOLLOWUP_INSUFFICIENT_EVIDENCE']);
add('RATE-ZERO-INVALID','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',
   fu_numeric_after:0,fu_numeric_denominator_after:0,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FIT'},experimentPlan:{primaryMetricBefore:3,primaryMetricDenominatorBefore:12}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_INVALID_MEASUREMENT']);
add('RATE-OVER-DEN-INVALID','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'yes',
   fu_numeric_after:15,fu_numeric_denominator_after:10,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'SUB_RENEWAL'},experimentPlan:{primaryMetricBefore:3,primaryMetricDenominatorBefore:12}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_INVALID_MEASUREMENT']);
add('RATE-DENOMINATOR-ROUTE','P1','FOLLOWUP',()=>{
 reset('followup',{fu_measurement_valid:'yes'});s.path=['fu_measurement_valid'];
 s.followupBase={result:{primaryCode:'FIT'},experimentPlan:{primaryMetricBefore:3,primaryMetricDenominatorBefore:10}};
 diag.goNext();s.answers.fu_numeric_after=2;diag.goNext();
 return s.path[2];
},['fu_numeric_denominator_after']);
add('RATE-OLD-PLAN-ROUTE','P1','FOLLOWUP',()=>{
 reset('followup',{fu_measurement_valid:'yes'});s.path=['fu_measurement_valid'];
 s.followupBase={result:{primaryCode:'FIT'},experimentPlan:{primaryMetricBefore:3}};
 diag.goNext();return s.path[1];
},['fu_effect']);


add('TARGET-N-COUNT-NOT-READY','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
 fu_measurement_valid:'yes',fu_observed_count:4,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{plannedObservationCount:12}};
 return diag.classifyFollowup().code+'|'+diag.classifyFollowup().decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|CONTINUE']);
add('TARGET-N-COUNT-READY','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
 fu_measurement_valid:'yes',fu_observed_count:12,fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{plannedObservationCount:12}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_CONFIRMED']);
add('TARGET-N-RATE-TOO-SMALL','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
 fu_measurement_valid:'yes',fu_numeric_after:0,fu_numeric_denominator_after:3,
 fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},
  experimentPlan:{plannedObservationCount:20,primaryMetricBefore:5,primaryMetricDenominatorBefore:100}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE']);
add('TARGET-N-RATE-ENOUGH','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
 fu_measurement_valid:'yes',fu_numeric_after:1,fu_numeric_denominator_after:30,
 fu_effect:'better',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'FULFILLMENT'},
  experimentPlan:{plannedObservationCount:20,primaryMetricBefore:8,primaryMetricDenominatorBefore:40}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_CONFIRMED']);
add('TARGET-N-CONDITIONAL-QUESTION','P1','FOLLOWUP',()=>{
 reset('followup',{fu_sample_ready:'yes'});s.path=['fu_sample_ready'];
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{plannedObservationCount:12}};
 diag.goNext();const next=s.path[1];s.answers.fu_observed_count=12;diag.goNext();
 return next+'|'+s.path[2];
},['fu_observed_count|fu_measurement_valid']);
add('TARGET-N-DENOMINATOR-NO-DOUBLE-QUESTION','P1','FOLLOWUP',()=>{
 reset('followup',{fu_sample_ready:'yes'});s.path=['fu_sample_ready'];
 s.followupBase={result:{primaryCode:'FIT'},
  experimentPlan:{plannedObservationCount:12,primaryMetricBefore:3,primaryMetricDenominatorBefore:20}};
 diag.goNext();return s.path[1];
},['fu_measurement_valid']);
add('TARGET-N-GUARDRAIL-HIGHER-PRIORITY','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
 fu_measurement_valid:'yes',fu_observed_count:2,fu_effect:'better',fu_guardrail:['safety']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{plannedObservationCount:12}};
 return diag.classifyFollowup().code;
},['FOLLOWUP_GUARDRAIL_FAIL']);


/* Real diagnosis selection: the earliest secondary contradiction must not
   hide a contradictory HARD GATE. Metamorphic variations across 5 models. */
add('SEL-MULTI-CONFLICT-SELF-FULFILL','P0','SELECTION',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('full',{scope_model:model,scope_goal:'new_sales',gate_fulfillment:'regular',
    deep_f1:['none'],deep_f2:'no',gate_economics:'good',gate_capacity:'reserve',
    core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
   const result=diag.diagnoseFull();
   return code(result)==='DATA_GAP' &&
       result.why.some(line=>line.includes('регулярные сбои выполнения') || line.includes('повторяющиеся случаи'));
 }));
},['true']);
add('SEL-MULTI-CONFLICT-SELF-ECON','P0','SELECTION',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('full',{scope_model:model,scope_goal:'new_sales',gate_fulfillment:'never',
    gate_economics:'negative',deep_e1:'no',deep_e2:'yes',deep_e3:['none'],
    core_offer:'no',deep_o1:['none'],deep_o2:'easy',gate_capacity:'reserve'});
   const result=diag.diagnoseFull();
   return code(result)==='DATA_GAP' &&
      result.why.some(line=>line.includes('убытков') || line.includes('экономику'));
 }));
},['true']);
add('SEL-MULTI-CONFLICT-OTHER-ECON','P0','SELECTION',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('full',{scope_model:model,scope_goal:'new_sales',
    gate_fulfillment:'regular',deep_f1:['none'],deep_f2:'no',
    gate_economics:'negative',gate_capacity:'reserve',
    core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
   return code(diag.diagnoseFull())==='ECONOMICS';
 }));
},['true']);
add('SEL-MULTI-CONFLICT-OTHER-CAP','P0','SELECTION',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('full',{scope_model:model,scope_goal:'new_sales',
    gate_fulfillment:'never',gate_economics:'negative',
    deep_e1:'no',deep_e2:'yes',deep_e3:['none'],gate_capacity:'overload',
    core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
   return code(diag.diagnoseFull())==='CAPACITY';
 }));
},['true']);
add('SEL-MULTI-CONFLICT-LEGAL-FIRST','P0','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',gate_legal:'yes',gate_fulfillment:'regular',
 deep_f1:['none'],deep_f2:'no',gate_economics:'negative',
 deep_e1:'no',deep_e2:'yes',deep_e3:['none']});
 return code(diag.diagnoseFull());
},['LEGAL_SAFETY_BLOCKER']);
add('SEL-MULTI-CONFLICT-FULFILL-REALLY-TRUE','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',
 gate_fulfillment:'regular',deep_f1:['deadline'],deep_f2:'no',
 gate_economics:'good',core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
 return code(diag.diagnoseFull());
},['FULFILLMENT']);
add('SEL-MULTI-CONFLICT-ECON-REALLY-TRUE','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',
 gate_economics:'negative',deep_e1:'yes',gate_fulfillment:'never',
 core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
 return code(diag.diagnoseFull());
},['ECONOMICS']);
add('SEL-MULTI-CONFLICT-ONLY-SECONDARY','P1','SELECTION',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',
 gate_economics:'good',gate_capacity:'reserve',gate_fulfillment:'never',
 core_offer:'no',deep_o1:['none'],deep_o2:'easy'});
 return code(diag.diagnoseFull());
},['DATA_GAP']);


/* Model-aware end-to-end routing through the real goNext() engine, not
   forced result codes. Run from the actual scope questions to result. */
function routeAllModels(kind){
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 const actual=[];
 for(const model of models){
   diag.startMode('full');
   const seen=[];
   let safety=0;
   while(!s.result && safety++<60){
     const id=s.path[s.index];
     if(!id) throw Error('missing question in '+model+'/'+kind);
     const answers={
       scope_goal:'new_sales',scope_name:'Тестовый продукт',scope_model:model,
       scope_target:'new_customers',maturity_state:kind==='full_access'?'repeatable':
         kind==='hybrid_channel'?'changed':'none',
       scope_period:'month',period_integrity:'normal',scope_geography:'local',
       gate_legal:kind==='build_research'?'unknown':'no',
       gate_fulfillment:'never',gate_capacity:'reserve',gate_economics:'good',
       core_demand:'regular',core_access:'none',core_offer:'yes',
       deep_a1:'yes',deep_a2:'no_decline',deep_a4:['social'],
       inheritance_entry:kind==='hybrid_channel'?'existing':'none',
       inheritance_map:['channel'],build_test_type:'research',
       build_offer:'yes',build_access:'yes',build_market:kind==='hybrid_channel'?'unknown':'no',
       build_market_sample:20,build_market_audience:'yes',build_market_test_complete:'yes'
     };
     if(!(id in answers)) throw Error('unexpected question '+id+' in '+model+'/'+kind);
     s.answers[id]=answers[id];seen.push(id);diag.goNext();
   }
   actual.push({model,result:code(s.result),seen:s.path.slice(0,s.index+1),visited:seen});
 }
 return actual;
}
add('ROUTE-FULL-ACCESS-5-MODELS','P1','ROUTING',()=>{
 const cases=routeAllModels('full_access');
 return String(cases.every(x=>x.result==='ACCESS'&&x.visited.length<=18 &&
   !x.visited.some(id=>['core_fit','core_trust','core_conversion'].includes(id))));
},['true']);
add('ROUTE-BUILD-RESEARCH-5-MODELS','P1','ROUTING',()=>{
 const cases=routeAllModels('build_research');
 return String(cases.every(x=>x.result==='BUILD_MARKET_TEST'&&x.visited.length<=12 &&
   !x.visited.some(id=>['build_market_sample','build_market_audience','build_market_test_complete',
   'build_route','build_econ_plausibility','build_pilot_capacity'].includes(id))));
},['true']);
add('ROUTE-HYBRID-CHANNEL-5-MODELS','P1','ROUTING',()=>{
 const cases=routeAllModels('hybrid_channel');
 return String(cases.every(x=>x.result==='BUILD_MARKET_TEST' &&
   !x.visited.some(id=>['build_offer','build_route','build_fulfillment','build_economics'].includes(id)) &&
   x.visited.includes('build_access')));
},['true']);
add('ROUTE-NONCOMMERCIAL-MISSING-SAMPLE-LEGAL','P0','ROUTING',()=>{
 reset('build',{build_test_type:'research',gate_legal:'unknown',build_market:'no'},
   ['build_market']);
 diag.goNext();
 return code(s.result)+'|'+String(!s.path.some(id=>['build_market_sample',
   'build_market_audience','build_market_test_complete'].includes(id)))+'|'+
   String(!/оплатить|бронь.*заказ|принять предоплату/.test(s.result.action||''));
},['BUILD_MARKET_TEST|true|true']);
add('ROUTE-WAITLIST-MISSING-SAMPLE','P1','ROUTING',()=>{
 reset('build',{build_test_type:'waitlist',build_market:'no'},['build_market']);
 diag.goNext();return code(s.result)+'|'+s.path.join(',');
},['BUILD_MARKET_TEST|build_market']);
add('ROUTE-PAID-STILL-ASKS-SAMPLE','P0','ROUTING',()=>{
 reset('build',{build_test_type:'payment',gate_legal:'no',build_market:'no'},['build_market']);
 diag.goNext();
 return String(!s.result&&s.path.includes('build_market_sample')&&s.path.includes('build_market_audience'));
},['true']);
add('ROUTE-RESEARCH-NO-FAKE-INCOMPLETE','P1','RESULT',()=>{
 reset('build',{build_test_type:'research',build_market:'no'},['build_market']);
 const out=diag.makeResult('BUILD_MARKET_TEST');
 return String(out.why.some(x=>x.includes('Покупку людям не предлагали')) &&
   !out.why.some(x=>x.includes('Вы ещё не закончили запланированный показ')) &&
   out.evidence.some(e=>e.questionId==='build_test_type'));
},['true']);


/* Back-mutation regressions: assert actual state path and the next question.
 * A simulated revised answer invokes the same downstream invalidator as the UI. */
function backMutate(mode,path,changedTo,additional={}){
 reset(mode,{scope_goal:'new_sales',scope_model:'PRODUCT',
   gate_fulfillment:'never',gate_economics:'good',gate_capacity:'reserve',
   ...additional,[path[0]]:changedTo},path);
 s.index=0;s.deepAdded=path.some(id=>id.startsWith('deep_'));
 // Pre-existing future answers represent a user going Back after proceeding.
 for(const id of path.slice(1))s.answers[id]='old-answer';
 diag.invalidateDownstreamAnswers(0);
 diag.goNext();
 return {next:s.path[s.index],path:[...s.path],answers:{...s.answers},result:code(s.result)};
}
add('BACK-FULL-RESTORE-DENOM-FIVE-MODELS','P0','BACK',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
  const o=backMutate('full',['core_access','core_offer','deep_a1','deep_a2'],'regular',
    {scope_model:model});
  return o.path.join(',')==='core_access,core_offer,core_fit,core_trust,core_conversion' &&
   o.next==='core_offer' && !('deep_a1' in o.answers);
 }));
},['true']);
add('BACK-FULL-REMOVE-DENOM-FIVE-MODELS','P1','BACK',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
  const o=backMutate('full',['core_access','core_offer','core_fit','core_trust','core_conversion'],'none',
     {scope_model:model});
  return o.path.join(',')==='core_access,core_offer' &&
   !('core_fit' in o.answers) && !('core_conversion' in o.answers);
 }));
},['true']);
add('BACK-RESTORE-CORE-AFTER-GATE','P0','BACK',()=>{
 const o=backMutate('full',['gate_fulfillment','deep_f1','deep_f2'],'never',
   {scope_goal:'new_sales',scope_model:'PRODUCT'});
 return String(o.path.join(',')==='gate_fulfillment,gate_capacity,gate_economics,core_demand,core_access,core_offer,core_fit,core_trust,core_conversion' &&
  o.next==='gate_capacity' && !('deep_f2' in o.answers));
},['true']);
add('BACK-REBUILD-ECON-FULL','P0','BACK',()=>{
 const o=backMutate('full',['gate_economics','deep_e1','deep_e3'],'good',
   {scope_goal:'income',scope_target:'per_sale'});
 return String(o.path.join(',')==='gate_economics,gate_capacity' &&
   !('deep_e1' in o.answers) && o.next==='gate_capacity');
},['true']);
add('BACK-PRUNE-STABLE-PERIOD','P1','BACK',()=>{
 const o=backMutate('full',['deep_a2','period_context','deep_a4'],'no_decline');
 return String(o.path.join(',')==='deep_a2,deep_a4' &&
   o.next==='deep_a4' && !('period_context' in o.answers));
},['true']);
add('BACK-RESTORE-CHANGED-PERIOD','P1','BACK',()=>{
 const o=backMutate('full',['deep_a2','deep_a4'],'views_down');
 return String(o.path.join(',')==='deep_a2,period_context,deep_a4' &&
   o.next==='period_context');
},['true']);
add('BACK-PRUNE-NO-REPEAT','P1','BACK',()=>{
 const o=backMutate('full',['deep_r1','deep_r2','deep_r3'],'no',{scope_goal:'repeat'});
 return String(!o.path.includes('deep_r2') && !o.path.includes('deep_r3') &&
   !('deep_r3' in o.answers));
},['true']);
add('BACK-PRUNE-NO-FULFILL-GROWTH','P1','BACK',()=>{
 const o=backMutate('full',['deep_f2','deep_cap1','deep_cap2'],'no',
  {gate_fulfillment:'regular',deep_f1:['overload']});
 return String(!o.path.includes('deep_cap1') && !o.path.includes('deep_cap2') &&
   !('deep_cap1' in o.answers));
},['true']);
add('BACK-PRUNE-SUB-CANCEL-REASON','P1','BACK',()=>{
 const o=backMutate('full',['sub_cancel_known','sub_cancel_reason'],'no',
  {scope_model:'SUBSCRIPTION'});
 return String(!o.path.includes('sub_cancel_reason') && !('sub_cancel_reason' in o.answers));
},['true']);
add('BACK-PRUNE-FIRST-VALUE-CAUSE','P1','BACK',()=>{
 const o=backMutate('full',['deep_s2','deep_s3'],'most',
  {scope_model:'EDUCATION',deep_s1:'most'});
 return String(!o.path.includes('deep_s3') && !('deep_s3' in o.answers));
},['true']);
add('BACK-PRUNE-VALUE-CAUSE','P1','BACK',()=>{
 const o=backMutate('full',['deep_v2','deep_v3'],'no',{core_value:'issues'});
 return String(!o.path.includes('deep_v3') && !('deep_v3' in o.answers));
},['true']);
add('BACK-PRUNE-NONLEARNING-START','P1','BACK',()=>{
 const o=backMutate('full',['deep_s1','deep_s2','deep_s3'],'no',
  {scope_model:'APPOINTMENT'});
 return String(!o.path.includes('deep_s2') && !o.path.includes('deep_s3'));
},['true']);
add('BACK-NO-DUPLICATE-DEEP','P1','BACK',()=>{
 // Deep is already selected, changing its own answer must not select
 // the very same branch again after the last relevant question.
 reset('full',{scope_goal:'new_sales',scope_model:'PRODUCT',core_access:'none',
   gate_capacity:'reserve',gate_economics:'good',
   deep_a2:'no_decline'},['deep_a2','deep_a4']);
 s.deepAdded=true;diag.invalidateDownstreamAnswers(0);
 return String(s.deepAdded === true);
},['true']);


/* Back transitions that can switch noncommercial actions to commitments.
   Assert safety questions reappear and the legal gate stays authoritative. */
add('BACK-BUILD-RESEARCH-TO-PAID-5-MODELS','P0','BACK',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('build',{scope_model:model,build_test_type:'payment',gate_legal:'unknown',
    build_offer:'yes',build_access:'yes',build_market:'no'},
    ['build_test_type','gate_legal','build_offer','build_access','build_market']);
   diag.invalidateDownstreamAnswers(0);diag.goNext();
   return s.path[1]==='gate_legal' &&
      s.path.includes('build_econ_plausibility') && s.path.includes('build_pilot_capacity') &&
      s.path.includes('build_route') && !('gate_legal' in s.answers);
 }));
},['true']);
add('BACK-BUILD-PAID-TO-RESEARCH-5-MODELS','P1','BACK',()=>{
 const models=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
 return String(models.every(model=>{
   reset('build',{scope_model:model,build_test_type:'research',gate_legal:'no',
    build_econ_plausibility:'yes',build_pilot_capacity:'yes',build_route:'yes'},
    ['build_test_type','gate_legal','build_econ_plausibility','build_pilot_capacity','build_route','build_offer','build_access','build_market']);
   diag.invalidateDownstreamAnswers(0);diag.goNext();
   return s.path.includes('gate_legal') && s.path.includes('build_offer') &&
    !['build_econ_plausibility','build_pilot_capacity','build_route'].some(id=>s.path.includes(id)) &&
    !('build_econ_plausibility' in s.answers);
 }));
},['true']);
add('BACK-HYBRID-RESEARCH-TO-PAID-LEGAL','P0','BACK',()=>{
 reset('hybrid',{scope_model:'PRODUCT',inheritance_map:['channel'],build_test_type:'payment',
  gate_legal:'unknown',build_access:'yes'},['build_test_type','gate_legal','build_access','build_market']);
 diag.invalidateDownstreamAnswers(0);diag.goNext();
 const next=s.path[s.index];
 s.answers.gate_legal='unknown';diag.goNext();
 return next+'|'+code(s.result);
},['gate_legal|LEGAL_SAFETY_BLOCKER']);
add('BACK-BUILD-RESEARCH-TO-PAID-LEGAL','P0','BACK',()=>{
 reset('build',{scope_model:'PRODUCT',build_test_type:'payment',gate_legal:'unknown'},
   ['build_test_type','gate_legal','build_offer','build_access','build_market']);
 diag.invalidateDownstreamAnswers(0);diag.goNext();
 s.answers.gate_legal='unknown';diag.goNext();
 return code(s.result);
},['LEGAL_SAFETY_BLOCKER']);
add('BACK-BUILD-PAID-NO-MARKET-COMMERCIAL-DENOM','P1','BACK',()=>{
 reset('build',{scope_model:'PRODUCT',build_test_type:'payment',gate_legal:'no',
 build_market:'no',build_market_quality:'target_normal'},
 ['build_market','build_market_quality']);
 diag.invalidateDownstreamAnswers(0);diag.goNext();
 return String(!s.result && s.path.includes('build_market_sample') &&
   s.path.includes('build_market_audience') && !('build_market_quality' in s.answers));
},['true']);
add('BACK-HYBRID-PAID-NO-MARKET-COMMERCIAL-DENOM','P1','BACK',()=>{
 reset('hybrid',{scope_model:'PRODUCT',build_test_type:'payment',gate_legal:'no',
 build_market:'no',build_market_quality:'target_normal'},
 ['build_market','build_market_quality']);
 diag.invalidateDownstreamAnswers(0);diag.goNext();
 return String(!s.result && s.path.includes('build_market_sample') &&
   s.path.includes('build_market_audience') && !('build_market_quality' in s.answers));
},['true']);
add('FU-UNCERTAIN-CONFOUNDING-STOPS-EARLY','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'unknown'},['fu_execution_match']);
 s.followupBase={result:{primaryCode:'ACCESS',userTitle:'Новые клиенты'}};
 diag.goNext();
 return String(s.result!==null && s.path.length===1 &&
  !s.path.includes('fu_sample_ready'));
},['true']);
add('FU-UNKNOWN-COMPARABILITY-STOPS-EARLY','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
   fu_measurement_valid:'unknown'},['fu_measurement_valid']);
 s.followupBase={result:{primaryCode:'ACCESS',userTitle:'Новые клиенты'}};
 diag.goNext();
 return String(s.result!==null && s.path.length===1 &&
  !s.path.includes('fu_effect') && !s.path.includes('fu_numeric_after'));
},['true']);
add('FU-NO-COMPARABILITY-STILL-STOPS','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',
   fu_measurement_valid:'no'},['fu_measurement_valid']);
 s.followupBase={result:{primaryCode:'ACCESS',userTitle:'Новые клиенты'}};
 diag.goNext();
 return String(s.result!==null && !s.path.includes('fu_effect'));
},['true']);


function historyTestId(){
 return diag.loadHistoryStore().cycles.find(z=>z.result?.resultId==='fu_hist_15')?.cycleId||null;
}
add('HIST-IMMUTABLE-INITIAL-ANSWERS','P0','HISTORY',()=>{
 reset('full',{scope_model:'PRODUCT',scope_goal:'new_sales',core_access:'none'});s.scopeId='scope_h15';
 const initial={resultId:'initial_hist_15',primaryCode:'ACCESS',diagnosticMode:'full',
 userTitle:'Исходный диагноз',why:['Новые люди не приходят'],businessGoal:'new_sales'};
 const first=diag.saveHistory({mode:'full',answers:{...s.answers},result:initial,
 cycleStatus:'ACTIVE',experimentPlan:{experimentId:'exp_hist_15',primaryCode:'ACCESS',status:'ACTIVE'}});
 const id=s.activeCycleId;
 const savedFu=diag.saveHistory({cycleId:id,mode:'followup',
 answers:{fu_done:'yes',fu_effect:'better'},
 result:{resultId:'fu_hist_15',primaryCode:'ACCESS',followup:true,diagnosticMode:'followup',
 userTitle:'Проверка',why:['Недостаточно наблюдений'],followupSnapshot:{followupId:'fu_snap_hist_15'}},
 cycleStatus:'WAITING_FOR_EVIDENCE'});
 const c=diag.loadHistoryStore().cycles.find(z=>z.cycleId===id);
 return String(first&&savedFu&&c?.answers?.core_access==='none'&&
  c.latestFollowupAnswers.fu_effect==='better'&&c.scope.diagnosticMode==='full'&&
  c.initialDiagnosisSnapshot.userTitle==='Исходный диагноз'&&c.followups.length===1);
},['true']);
add('HIST-REPEAT-FU-ORIGINAL-BASE','P0','HISTORY',()=>{
 const ok=diag.startFollowupForCycle(historyTestId());
 return String(ok&&s.followupBase.result.userTitle==='Исходный диагноз'&&
  s.followupBase.answers.core_access==='none'&&s.followupBase.experimentPlan.primaryCode==='ACCESS');
},['true']);
add('HIST-RESUME-LATEST-BUT-BASE-ORIGINAL','P0','HISTORY',()=>{
 const ok=diag.resumeCycle(historyTestId());
 return String(ok&&s.result.userTitle==='Проверка'&&s.followupBase.result.userTitle==='Исходный диагноз'&&
  s.answers.core_access==='none'&&!s.result.experimentPlan);
},['true']);
add('HIST-ORPHAN-FU-BLOCKED','P0','HISTORY',()=>{
 reset('followup',{fu_done:'yes'});s.activeCycleId=null;
 const n=diag.loadHistoryStore().cycles.length;
 const saved=diag.saveHistory({cycleId:'nonexistent_parent_15',mode:'followup',
  answers:{fu_done:'yes'},result:{followup:true,primaryCode:'ACCESS'},cycleStatus:'ACTIVE'});
 return String(!saved&&diag.loadHistoryStore().cycles.length===n);
},['true']);
add('HIST-TRANSITION-READS-ORIGINAL-ANSWERS','P0','HISTORY',()=>{
 reset('followup',{fu_done:'yes',fu_effect:'better'});
 s.followupBase={result:{primaryCode:'ACCESS',diagnosticMode:'full',businessGoal:'new_sales'},
 mode:'full',answers:{scope_goal:'new_sales',scope_model:'PRODUCT',
  gate_legal:'no',gate_fulfillment:'never',gate_economics:'negative',gate_capacity:'reserve',
  core_access:'none',core_demand:'regular',core_offer:'yes'}};
 s.precisionExcludedZones=[];
 const before=JSON.stringify(s.answers);
 const out=diag.buildStateTransition({outcome:'R+',code:'FOLLOWUP_CONFIRMED',decision:'CONFIRM'});
 return String(out.nextResult?.primaryCode==='ECONOMICS'&&JSON.stringify(s.answers)===before&&s.mode==='followup');
},['true']);


add('HIST-STORAGE-CORRUPT-NEVER-OVERWRITE','P0','HISTORY',()=>{
 const key='salesDiagnosticHistory:v2',old=memory[key];memory[key]='{broken';
 const blocked=diag.historyStorageProblem();
 const saved=diag.saveHistory({result:{resultId:'corrupt_test',primaryCode:'ACCESS',why:['x']},mode:'full'});
 const unchanged=memory[key]==='{broken';
 if(old===undefined)delete memory[key];else memory[key]=old;
 return String(!!blocked&&!saved&&unchanged);
},['true']);
add('HIST-STORAGE-NEWER-SCHEMA-NEVER-OVERWRITE','P0','HISTORY',()=>{
 const key='salesDiagnosticHistory:v2',old=memory[key];memory[key]=JSON.stringify({schemaVersion:99,cycles:[{test:true}]});
 const saved=diag.saveHistory({result:{resultId:'future_schema',primaryCode:'ACCESS',why:['x']},mode:'full'});
 const unchanged=JSON.parse(memory[key]).schemaVersion===99;
 if(old===undefined)delete memory[key];else memory[key]=old;
 return String(!saved&&unchanged);
},['true']);
add('HIST-IMPORT-REFUSE-INVALID-JSON','P0','HISTORY',()=>String(!diag.reviewHistoryImport('{invalid').ok),['true']);
add('HIST-IMPORT-REFUSE-WRONG-SCHEMA','P0','HISTORY',()=>{
 const payload={exportVersion:1,historySchemaVersion:99,cycles:[]};
 return String(!diag.reviewHistoryImport(JSON.stringify(payload)).ok);
},['true']);
add('HIST-IMPORT-REFUSE-MALFORMED-CYCLE','P0','HISTORY',()=>{
 const payload={exportVersion:1,historySchemaVersion:2,cycles:[{cycleId:'cycle_wrong',schemaVersion:2}]};
 return String(!diag.reviewHistoryImport(JSON.stringify(payload)).ok);
},['true']);
add('HIST-IMPORT-NEW-CYCLE-AND-IDEMPOTENT','P0','HISTORY',()=>{
 const key='salesDiagnosticHistory:v2',original=memory[key];
 // This cycle has no experiment plan and uses a valid result contract.
 const incoming={cycleId:'cycle_import_single_161',scopeId:'s_i',schemaVersion:2,
  status:'COMPLETED',legacyReadonly:false,createdAt:'2026-10-10T10:00:00Z',
  updatedAt:'2026-10-10T10:00:00Z',scope:{name:'Сохранённый тест',diagnosticMode:'full'},
  answers:{scope_goal:'new_sales'},result:{resultId:'r_import_161',primaryCode:'ACCESS',
   userTitle:'Сохранённый вывод',why:['Приток нерегулярен']},
  experimentPlan:null,precisionSnapshots:[],followups:[],transition:null,parentCycleId:null,nextCycleId:null};
 const text=JSON.stringify({exportVersion:1,historySchemaVersion:2,cycles:[incoming]});
 const preview=diag.reviewHistoryImport(text);
 const success=preview.ok&&preview.newCount===1&&diag.commitHistoryImport(text,preview.currentRaw);
 const repeated=diag.reviewHistoryImport(text);
 const idempotent=repeated.ok&&repeated.newCount===0&&repeated.duplicateCount===1;
 const noDuplicate=diag.loadHistoryStore().cycles.filter(c=>c.cycleId===incoming.cycleId).length===1;
 if(original===undefined)delete memory[key];else memory[key]=original;
 return String(success&&idempotent&&noDuplicate);
},['true']);
add('HIST-IMPORT-CONFLICT-BLOCKS','P0','HISTORY',()=>{
 const current=diag.loadHistoryStore().cycles[0];
 if(!current)return 'no cycles';
 const other={...current,updatedAt:'2000-01-01T00:00:00Z'};
 const payload=JSON.stringify({exportVersion:1,historySchemaVersion:2,cycles:[other]});
 return String(!diag.reviewHistoryImport(payload).ok);
},['true']);
add('HIST-IMPORT-STALE-PREVIEW-BLOCKS','P0','HISTORY',()=>{
 const txt=JSON.stringify({exportVersion:1,historySchemaVersion:2,cycles:[]});
 const review=diag.reviewHistoryImport(txt);
 return String(review.ok&&!diag.commitHistoryImport(txt,review.currentRaw===null?'stale':'different history'));
},['true']);
add('HIST-IMPORT-AVAILABLE-ON-EMPTY-HOME','P1','HISTORY',()=>{
 return String(html.includes("Import must also be accessible on a fresh browser")&&
   html.includes("importFile.type='file'")&&html.includes("importButton.addEventListener('click'"));
},['true']);


function archiveFixture(id,resultId,expId=null,more={}){
 return {cycleId:id,scopeId:'scope_import',schemaVersion:2,status:'COMPLETED',
 legacyReadonly:false,createdAt:'2026-10-12T10:00:00Z',updatedAt:'2026-10-12T10:00:00Z',
 scope:{name:'Архив',diagnosticMode:'full'},answers:{scope_model:'PRODUCT'},
 result:{resultId,primaryCode:'ACCESS',userTitle:'Архивный вывод',why:['Один факт']},
 experimentPlan:expId?{experimentId:expId,executionSteps:[],secondaryMetrics:[],holdConstant:[]}:null,
 precisionSnapshots:[],followups:[],transition:null,parentCycleId:null,nextCycleId:null,...more};
}
function archivePayload(c){return JSON.stringify({exportVersion:1,historySchemaVersion:2,cycles:c})}
add('ARCHIVE-INITIAL-DIAG-ID-COLLISION','P0','HISTORY',()=>{
 const c=diag.loadHistoryStore().cycles.find(c=>c.initialDiagnosisSnapshot?.resultId==='initial_hist_15');
 return String(!!c&&!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_conflict_initial','initial_hist_15')])).ok);
},['true']);
add('ARCHIVE-LATEST-DIAG-ID-COLLISION','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_conflict_latest','fu_hist_15')])).ok),['true']);
add('ARCHIVE-EXPERIMENT-ID-COLLISION','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_conflict_exp','import_unique_r','exp_hist_15')])).ok),['true']);
add('ARCHIVE-DUPLICATE-RESULT-IN-FILE','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([
 archiveFixture('cycle_duble1','same_r'),archiveFixture('cycle_duble2','same_r')])).ok),['true']);
add('ARCHIVE-DUPLICATE-EXPERIMENT-IN-FILE','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([
 archiveFixture('cycle_duble3','r3','same_e'),archiveFixture('cycle_duble4','r4','same_e')])).ok),['true']);
add('ARCHIVE-ORPHAN-PARENT','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_orphan','r_orphan',null,
 {parentCycleId:'cycle_nonexistent'})])).ok),['true']);
add('ARCHIVE-SELF-CYCLE','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_self','r_self',null,
 {parentCycleId:'cycle_self'})])).ok),['true']);
add('ARCHIVE-LOOP-TWO-CYCLES','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([
 archiveFixture('cycle_loop_a','r_loop_a',null,{parentCycleId:'cycle_loop_b'}),
 archiveFixture('cycle_loop_b','r_loop_b',null,{parentCycleId:'cycle_loop_a'})])).ok),['true']);
add('ARCHIVE-BAD-FOLLOWUP-ARRAY','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_bad_followup','r_bad_fu',null,
 {followups:'corrupted'})])).ok),['true']);
add('ARCHIVE-BAD-PRECISION-ARRAY','P0','HISTORY',()=>
 String(!diag.reviewHistoryImport(archivePayload([archiveFixture('cycle_bad_precision','r_bad_p',null,
 {precisionSnapshots:[null]})])).ok),['true']);
add('ARCHIVE-COLLISION-NO-WRITE','P0','HISTORY',()=>{
 const before=memory['salesDiagnosticHistory:v2'];
 const payload=archivePayload([archiveFixture('cycle_no_write','initial_hist_15')]);
 const reviewed=diag.reviewHistoryImport(payload);
 const applied=diag.commitHistoryImport(payload,reviewed.currentRaw);
 return String(!reviewed.ok&&!applied&&memory['salesDiagnosticHistory:v2']===before);
},['true']);
add('ARCHIVE-LINKED-PAIR-RESTORES','P1','HISTORY',()=>{
 const before=memory['salesDiagnosticHistory:v2'];
 const payload=archivePayload([
 archiveFixture('cycle_linked_1','r_linked_1',null,{nextCycleId:'cycle_linked_2'}),
 archiveFixture('cycle_linked_2','r_linked_2',null,{parentCycleId:'cycle_linked_1'})]);
 const preview=diag.reviewHistoryImport(payload);
 const saved=preview.ok&&diag.commitHistoryImport(payload,preview.currentRaw);
 const count=diag.loadHistoryStore().cycles.filter(c=>c.cycleId.startsWith('cycle_linked_')).length;
 if(before===undefined)delete memory['salesDiagnosticHistory:v2'];
 else memory['salesDiagnosticHistory:v2']=before;
 return String(saved&&count===2);
},['true']);
add('ARCHIVE-EXPLICIT-CYCLE-ID-AUTHORITATIVE','P0','HISTORY',()=>{
 const before=diag.loadHistoryStore().cycles.find(c=>c.result?.resultId==='fu_hist_15');
 if(!before)return 'fixture missing';
 const snap=JSON.stringify(before);
 const result=diag.saveHistory({cycleId:'cycle_missing_but_experiment_matches',
 experimentPlan:{experimentId:'exp_hist_15'},mode:'followup',answers:{fu_done:'yes'},
 result:{resultId:'wrong_history_fu',followup:true,primaryCode:'ACCESS',why:['wrong']},
 cycleStatus:'WAITING_FOR_EVIDENCE'});
 const after=diag.loadHistoryStore().cycles.find(c=>c.cycleId===before.cycleId);
 return String(!result&&JSON.stringify(after)===snap);
},['true']);


function isolatedHistory(run) {
 const key='salesDiagnosticHistory:v2', before=memory[key];
 const restore=()=>{if(before===undefined)delete memory[key];else memory[key]=before;};
 try{
  const result=run(key);
  if(result && typeof result.then==='function')return result.finally(restore);
  restore();return result;
 }catch(e){restore();throw e;}
}
add('HIST-PRUNE-PRESERVES-ACTIVE-ANCESTOR','P0','HISTORY',()=>isolatedHistory(key=>{
 const store={schemaVersion:2,cycles:[],activeCycleIds:[],lastActiveCycleId:null,legacyMigratedAt:'2026-10-12',updatedAt:'2026-10-12'};
 const parent=archiveFixture('cycle_prune_parent','prune_parent');
 parent.updatedAt='2000-01-01T00:00:00Z';
 const child=archiveFixture('cycle_prune_active','prune_active',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 store.cycles=[parent,...Array.from({length:21},(_,i)=>archiveFixture('cycle_prune_other_'+i,'prune_other_'+i)),child];
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 const saved=diag.writeHistoryStore(store);
 const kept=diag.loadHistoryStore().cycles,ids=new Set(kept.map(c=>c.cycleId));
 const importable=diag.reviewHistoryImport(archivePayload(kept)).ok;
 return String(saved && kept.length<=20 && ids.has(parent.cycleId) && ids.has(child.cycleId) && importable);
}),['true']);
add('HIST-PRUNE-REFUSES-OVERLIMIT-LINKED-GROUP','P0','HISTORY',()=>isolatedHistory(key=>{
 const previous=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]}); memory[key]=previous;
 const cycles=Array.from({length:21},(_,i)=>archiveFixture('cycle_limit_'+i,'limit_'+i));
 cycles.forEach((c,i)=>{c.parentCycleId=i?cycles[i-1].cycleId:null;c.nextCycleId=i<cycles.length-1?cycles[i+1].cycleId:null;});
 const store={schemaVersion:2,cycles,activeCycleIds:[],lastActiveCycleId:null};
 return String(!diag.writeHistoryStore(store) && memory[key]===previous);
}),['true']);
add('HIST-CLEAR-PRESERVES-ACTIVE-ANCESTORS','P0','HISTORY',()=>isolatedHistory(key=>{
 const parent=archiveFixture('cycle_clear_parent','clear_parent');
 const child=archiveFixture('cycle_clear_child','clear_child',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 const extra=archiveFixture('cycle_clear_unrelated','clear_unrelated');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[parent,child,extra],activeCycleIds:[child.cycleId]});
 const ok=diag.clearClosedHistory(),kept=diag.loadHistoryStore().cycles.map(c=>c.cycleId);
 return String(ok && kept.includes(parent.cycleId)&&kept.includes(child.cycleId)&&!kept.includes(extra.cycleId));
}),['true']);
add('HIST-DELETE-REFERENCED-CLOSED-BLOCKED','P0','HISTORY',()=>isolatedHistory(key=>{
 const parent=archiveFixture('cycle_delete_parent','delete_parent');
 const child=archiveFixture('cycle_delete_child','delete_child',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[parent,child],activeCycleIds:[child.cycleId]});
 const previous=memory[key],result=diag.deleteCycle(parent.cycleId);
 return String(!result && memory[key]===previous);
}),['true']);
add('HIST-LARGE-EXPORT-ROUNDTRIP','P1','HISTORY',()=>isolatedHistory(key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 const cycles=Array.from({length:20},(_,i)=>archiveFixture('cycle_large_'+i,'large_'+i,null,{answers:{note:'z'.repeat(56000)}}));
 const payload=archivePayload(cycles);
 return String(payload.length>1024*1024 && diag.reviewHistoryImport(payload).ok);
}),['true']);
add('HIST-OVER-10MB-REJECTED','P1','HISTORY',()=>isolatedHistory(key=>{
 const payload=archivePayload([archiveFixture('cycle_huge','huge',null,{answers:{note:'X'.repeat(11*1024*1024)}})]);
 return String(!diag.reviewHistoryImport(payload).ok);
}),['true']);


add('SAFETY-FU-CONFLICT-HARM-FIRST','P0','FOLLOWUP',()=>{
 const v=classify({fu_done:'yes',fu_execution_match:'unknown',fu_guardrail:['money']});
 return v.code+'|'+v.decision;
},['FOLLOWUP_GUARDRAIL_FAIL|ROLLBACK']);
add('SAFETY-FU-LOW-SAMPLE-HARM-FIRST','P0','FOLLOWUP',()=>{
 const v=classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'not_yet',fu_guardrail:['quality']});
 return v.code;
},['FOLLOWUP_GUARDRAIL_FAIL']);
add('SAFETY-FU-CAP-SAFETY-FIRST','P0','FOLLOWUP',()=>{
 const v=classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'cap',fu_guardrail:['safety']});
 return v.code;
},['FOLLOWUP_GUARDRAIL_FAIL']);
add('SAFETY-FU-BAD-COMPARISON-HARM-FIRST','P0','FOLLOWUP',()=>{
 const v=classify({fu_done:'yes',fu_execution_match:'no',fu_sample_ready:'yes',fu_measurement_valid:'no',fu_guardrail:['load']});
 return v.code;
},['FOLLOWUP_GUARDRAIL_FAIL']);
add('SAFETY-FU-DIFFERENT-CHANGE-HARM-FIRST','P0','FOLLOWUP',()=>{
 const v=classify({fu_done:'different',fu_guardrail:['safety']});
 return v.code;
},['FOLLOWUP_GUARDRAIL_FAIL']);
add('SAFETY-FU-NOT-EXECUTED-UNCHANGED','P1','FOLLOWUP',()=>{
 const v=classify({fu_done:'no',fu_guardrail:['money']});
 return v.code;
},['FOLLOWUP_NOT_EXECUTED']);
add('SAFETY-FU-ENTRY-ROUTE-GUARD-FIRST','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes'});s.path=['fu_done'];s.index=0;
 diag.goNext();
 return s.path[1];
},['fu_guardrail']);
add('SAFETY-FU-HARM-ROUTE-EARLY-STOP','P0','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_guardrail:['money']});
 s.path=['fu_done','fu_guardrail'];s.index=1;
 s.followupBase={result:{primaryCode:'ACCESS',userTitle:'Поток новых клиентов',diagnosticMode:'full'},experimentPlan:{primaryCode:'ACCESS'}};
 diag.goNext();
 return s.result?.followupCode+'|'+String(s.path.includes('fu_execution_match'));
},['FOLLOWUP_GUARDRAIL_FAIL|false']);
add('SAFETY-FU-NO-HARM-ROUTE-CONTINUES','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_guardrail:['none']});
 s.path=['fu_done','fu_guardrail'];s.index=1;
 diag.goNext();return s.path[2];
},['fu_execution_match']);
add('SAFETY-FU-NO-REPEATED-GUARDRAIL','P1','FOLLOWUP',()=>{
 reset('followup',{fu_effect:'better',fu_guardrail:['none']});
 s.path=['fu_done','fu_guardrail','fu_execution_match','fu_sample_ready','fu_measurement_valid','fu_effect'];s.index=5;
 s.followupBase={result:{primaryCode:'BUILD_MARKET_TEST'},experimentPlan:{primaryCode:'BUILD_MARKET_TEST'}};
 diag.goNext();
 return s.path.slice(-2).join('|')+'|'+s.path.filter(v=>v==='fu_guardrail').length;
},['fu_effect|fu_market_payment|1']);


/* History UI E2E with real event handlers + simulated file objects.
 * This is not a native browser test. */
function uiFind(pred){
 const queue=[documentMock.getElementById('app')];
 while(queue.length){
  const el=queue.shift();
  if(pred(el))return el;
  queue.push(...(el.children||[]));
 }
 return null;
}
async function uiFire(el,type){
 if(!el)throw Error('UI target not found: '+type);
 for(const handler of el._events?.[type]||[])await handler();
}
function uiPicker(){return uiFind(n=>n.type==='file');}
function uiCheckButton(){return uiFind(n=>n.textContent==='Проверить выбранный файл');}
function uiAddVisible(){return uiFind(n=>n.type==='button'&&n.textContent?.startsWith('Добавить новые записи')&&!n.hidden);}
function uiSelectedArchive(payload){
 const picker=uiPicker();
 picker.files=[{name:'sales-diagnostic-history.json',size:payload.length,text:async()=>payload}];
 return picker;
}
add('UI-HISTORY-NO-BULK-DELETE-WHEN-EMPTY','P2','HISTORY-UI',()=>isolatedHistory(key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 diag.showHome();
 return String(!uiFind(n=>n.textContent?.startsWith('Удалить завершённые проверки'))&&
  !!uiFind(n=>n.textContent?.includes('Удалять пока нечего')));
}),['true']);
add('UI-HISTORY-NO-BULK-DELETE-IF-LINKED','P1','HISTORY-UI',()=>isolatedHistory(key=>{
 const parent=archiveFixture('cycle_uiparent','uiparent');
 const child=archiveFixture('cycle_uichild','uichild',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[parent,child],activeCycleIds:[child.cycleId]});
 diag.showHome();
 return String(!uiFind(n=>n.textContent?.startsWith('Удалить завершённые проверки'))&&
   !!uiFind(n=>n.textContent?.includes('Завершённые проверки связаны с активными')));
}),['true']);
add('UI-HISTORY-BULK-DELETE-COUNT-AND-STATUS','P1','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const parent=archiveFixture('cycle_uiparent2','uiparent2');
 const child=archiveFixture('cycle_uichild2','uichild2',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 const other=archiveFixture('cycle_uiother','uiother');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[parent,child,other],activeCycleIds:[child.cycleId]});
 diag.showHome();
 await uiFire(uiFind(n=>n.textContent==='Удалить завершённые проверки (1)'),'click');
 const ids=diag.loadHistoryStore().cycles.map(c=>c.cycleId);
 return String(ids.includes(parent.cycleId)&&ids.includes(child.cycleId)&&!ids.includes(other.cycleId)&&
  !!uiFind(n=>n.textContent?.includes('Удалено завершённых проверок: 1')));
}),['true']);
add('UI-IMPORT-NO-FILE-EXPLAINS','P2','HISTORY-UI',async()=>isolatedHistory(async key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 diag.showHome();
 await uiFire(uiCheckButton(),'click');
 return String(!!uiFind(n=>n.textContent?.includes('Сначала выберите файл экспорта истории')));
}),['true']);
add('UI-IMPORT-UNCHANGED-ARCHIVE-EXPLAINS','P1','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const one=archiveFixture('cycle_uisame','uisame');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[one],activeCycleIds:[]});
 diag.showHome();
 const picker=uiSelectedArchive(archivePayload([one]));
 await uiFire(picker,'change');
 await uiFire(uiCheckButton(),'click');
 return String(!!uiFind(n=>n.textContent?.includes('Новых записей нет'))&&!uiAddVisible());
}),['true']);
add('UI-IMPORT-VALID-REQUIRES-SECOND-ACTION','P1','HISTORY-UI',async()=>isolatedHistory(async key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 diag.showHome();
 const one=archiveFixture('cycle_uinew','uinew');
 const picker=uiSelectedArchive(archivePayload([one]));
 await uiFire(picker,'change');
 await uiFire(uiCheckButton(),'click');
 const button=uiAddVisible(),before=diag.loadHistoryStore().cycles.length;
 if(!button)return 'no confirmation button';
 await uiFire(button,'click');
 const after=diag.loadHistoryStore().cycles.length;
 return String(before===0&&after===1&&
  !!uiFind(n=>n.textContent?.includes('Добавлено записей: 1')));
}),['true']);
add('UI-IMPORT-INVALID-BLOCKED-WITH-REASON','P0','HISTORY-UI',async()=>isolatedHistory(async key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 diag.showHome();const before=memory[key];
 const picker=uiSelectedArchive('{bad json}');
 await uiFire(picker,'change');
 await uiFire(uiCheckButton(),'click');
 return String(!!uiFind(n=>n.textContent?.includes('не содержит корректный JSON'))&&
  !uiAddVisible() && memory[key]===before);
}),['true']);
add('UI-IMPORT-CANCEL-DOES-NOT-WRITE','P1','HISTORY-UI',async()=>isolatedHistory(async key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 diag.showHome();
 const one=archiveFixture('cycle_uicancel','uicancel');
 const picker=uiSelectedArchive(archivePayload([one]));
 await uiFire(picker,'change');await uiFire(uiCheckButton(),'click');
 const originalConfirm=windowMock.confirm;
 windowMock.confirm=()=>false;
 const before=memory[key];
 try{await uiFire(uiAddVisible(),'click');}
 finally{windowMock.confirm=originalConfirm;}
 return String(memory[key]===before &&
  !!uiFind(n=>n.textContent?.includes('Импорт отменён')));
}),['true']);


add('UI-HISTORY-LINKED-PARENT-NO-INDIVIDUAL-DELETE','P1','HISTORY-UI',()=>isolatedHistory(key=>{
 const parent=archiveFixture('cycle_uilinkedparent','uilinkedparent');
 const child=archiveFixture('cycle_uilinkedchild','uilinkedchild',null,{parentCycleId:parent.cycleId,status:'ACTIVE'});
 parent.nextCycleId=child.cycleId;
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[parent,child],activeCycleIds:[child.cycleId]});
 diag.showHome();
 return String(!uiFind(n=>n.textContent==='Удалить'&&n.type==='button'));
}),['true']);


/* Full paid routes through actual goNext across all five business models. */
const paidModels=['PRODUCT','APPOINTMENT','EXPERT','EDUCATION','SUBSCRIPTION'];
function paidRoute(model,variant,changes={}){
 diag.startMode('full');
 const visited=[],problems=[];
 const a={scope_goal:variant==='full'?'income':'new_sales',
  scope_name:'Offer '+model,scope_model:model,scope_target:variant==='full'?'revenue':'new_customers',
  maturity_state:variant==='full'?'repeatable':variant.startsWith('hybrid')?'changed':'none',
  scope_period:'month',period_integrity:'normal',scope_geography:'local',
  gate_legal:'no',gate_fulfillment:'never',gate_economics:'good',gate_capacity:'reserve',
  core_access:'regular',core_offer:'yes',core_demand:'regular',core_fit:'most',core_trust:'rare',core_conversion:'most',
  inheritance_entry:variant.startsWith('hybrid')?'existing':'none',
  inheritance_map:variant==='hybrid_price'?['price']:variant==='hybrid_audience'?['audience']:['channel'],
  build_test_type:'payment',build_econ_plausibility:'yes',build_pilot_capacity:'yes',
  build_offer:'yes',build_route:'yes',build_access:'yes',build_market_context:'yes',
  build_market:'paid',build_market_quality:'target_normal',
  shared_resources:['none'],shared_materiality:'no',shared_impact:'none',
  deep_e1:'no',deep_e2:'yes',deep_e3:['none'],...changes};
 for(let i=0;i<60&&!s.result;i++){
  const id=s.path[s.index];
  if(!(id in a)){problems.push('unexpected '+id);break;}
  visited.push(id);s.answers[id]=a[id];
  try{diag.goNext()}catch(e){problems.push(e.message);break;}
 }
 return {model,variant,visited,code:code(s.result),problems,businessGoal:s.businessGoal};
}
add('PAID-BUILD-5-MODELS-REDUCED','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'build'));
 return String(xs.every(x=>!x.problems.length && x.code==='BUILD_FULFILLMENT'&&
  x.visited.length<=16 && x.businessGoal==='new_sales'&&
  !x.visited.includes('scope_geography')&&!x.visited.includes('build_market_context')));
},['true']);
add('PAID-HYBRID-PRICE-5-MODELS','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'hybrid_price'));
 return String(xs.every(x=>!x.problems.length&&x.code==='BUILD_FULFILLMENT'&&
  x.visited.length<=14&&x.visited.includes('build_econ_plausibility')&&
  !x.visited.includes('scope_geography')));
},['true']);
add('PAID-HYBRID-CHANNEL-5-MODELS','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'hybrid_channel'));
 return String(xs.every(x=>!x.problems.length&&x.code==='BUILD_FULFILLMENT'&&
  x.visited.length<=13&&x.visited.includes('build_access')&&
  !['scope_geography','build_offer','build_route'].some(id=>x.visited.includes(id))));
},['true']);
add('PAID-HYBRID-AUDIENCE-5-MODELS','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'hybrid_audience'));
 return String(xs.every(x=>!x.problems.length&&x.code==='BUILD_FULFILLMENT'&&
  x.visited.includes('build_access')&&
  !['scope_geography','build_market_context'].some(id=>x.visited.includes(id))));
},['true']);
add('PAID-FULL-REVENUE-5-MODELS','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'full'));
 return String(xs.every(x=>!x.problems.length&&x.code==='NO_CRITICAL_CONSTRAINT_FOUND'&&
  x.visited.length<=12&&x.businessGoal==='income'&&
  x.visited.includes('gate_economics')&&x.visited.includes('gate_capacity')));
},['true']);
add('PAID-BUILD-LEGAL-5-MODELS','P0','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'build',{gate_legal:'unknown'}));
 return String(xs.every(x=>!x.problems.length&&x.code==='LEGAL_SAFETY_BLOCKER'&&
  x.visited.includes('gate_legal')&&!x.visited.includes('build_market')));
},['true']);
add('PAID-HYBRID-LEGAL-5-MODELS','P0','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'hybrid_channel',{gate_legal:'unknown'}));
 return String(xs.every(x=>!x.problems.length&&x.code==='LEGAL_SAFETY_BLOCKER'&&
  x.visited.includes('gate_legal')&&!x.visited.includes('build_market')));
},['true']);
add('PAID-FRIEND-PURCHASE-5-MODELS','P1','ROUTING',()=>{
 const xs=paidModels.map(m=>paidRoute(m,'build',{build_market_quality:'friend_support'}));
 return String(xs.every(x=>!x.problems.length&&x.code==='BUILD_MARKET_TEST'&&
  x.visited.includes('build_market_quality')));
},['true']);


/* Atomic Follow-up handoff + simulated clean-profile roundtrip. */
function setupHandoff(key,tag){
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 reset('build',{scope_goal:'new_sales',scope_name:'Подарочный набор',scope_model:'PRODUCT',
  scope_target:'new_customers',gate_legal:'no',build_market:'no'});
 s.parentCycleId=null;
 const first=diag.makeResult('BUILD_MARKET_TEST');
 const plan={experimentId:'exp_handoff_'+tag,primaryCode:'BUILD_MARKET_TEST',
   status:'ACTIVE',executionSteps:['Показать предложение'],secondaryMetrics:[],holdConstant:[],
   changeOneThing:'Изменить показ',observationRule:'После первой проверки'};
 if(!diag.saveHistory({mode:'build',scope:'Подарочный набор',answers:{...s.answers},
  result:first,experimentPlan:plan,cycleStatus:'ACTIVE'}))throw Error('could not prepare parent');
 const parentId=s.activeCycleId,firstId=first.resultId;
 const initial=JSON.stringify(diag.loadHistoryStore().cycles.find(c=>c.cycleId===parentId).answers);
 if(!diag.startFollowupForCycle(parentId))throw Error('could not start Follow-up');
 s.answers={fu_done:'yes',fu_guardrail:['none'],fu_execution_match:'no',
  fu_sample_ready:'yes',fu_measurement_valid:'yes',fu_effect:'better',fu_market_payment:'yes'};
 const next=diag.makeResult('BUILD_FULFILLMENT');
 next.diagnosticMode='build';
 next.experimentPlan={experimentId:'exp_handoff_next_'+tag,primaryCode:'BUILD_FULFILLMENT',
  status:'PLANNED',executionSteps:['Выполнить заказ'],secondaryMetrics:[],holdConstant:[],
  changeOneThing:'Выполнить первый заказ',observationRule:'После доставки'};
 const fu=diag.makeResult('BUILD_MARKET_TEST');
 fu.followup=true;
 fu.resultId='result_handoff_fu_'+tag;
 fu.userTitle='Результат повторной проверки';
 fu.why=['Первое действие проверено'];
 fu.followupSnapshot={followupId:'fu_handoff_'+tag,experimentId:plan.experimentId};
 fu.stateTransition={type:'BUILD_PHASE_ADVANCED',fromPrimaryCode:'BUILD_MARKET_TEST',
   toPrimaryCode:'BUILD_FULFILLMENT',nextResult:next};
 s.result=fu;
 return {parentId,firstId,initial,fu,next};
}
add('HANDOFF-ATOMIC-SAVE-FOLLOWUP','P0','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'atomic');
 const ok=diag.startLinkedCycle(f.parentId,f.next);
 const cs=diag.loadHistoryStore().cycles;
 const p=cs.find(c=>c.cycleId===f.parentId);
 const child=cs.find(c=>c.parentCycleId===f.parentId);
 return String(ok&&cs.length===2&&p.status==='COMPLETED'&&
  p.result.resultId===f.fu.resultId&&p.followups.length===1&&
  p.latestFollowupAnswers.fu_effect==='better'&&
  p.initialDiagnosisSnapshot.resultId===f.firstId&&
  JSON.stringify(p.initialAnswersSnapshot)===f.initial&&
  p.nextCycleId===child?.cycleId);
}),['true']);
add('HANDOFF-PRE-SAVED-NO-DOUBLE-FU','P0','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'saved');
 const saved=diag.saveHistory({cycleId:f.parentId,mode:'followup',
  answers:{...s.answers},result:f.fu,cycleStatus:'COMPLETED'});
 const linked=diag.startLinkedCycle(f.parentId,f.next);
 const p=diag.loadHistoryStore().cycles.find(c=>c.cycleId===f.parentId);
 return String(saved&&linked&&p.followups.length===1&&
  p.result.resultId===f.fu.resultId&&p.initialDiagnosisSnapshot.resultId===f.firstId);
}),['true']);
add('HANDOFF-EXPORT-IMPORT-CLEAN-PROFILE','P0','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'clean');
 if(!diag.startLinkedCycle(f.parentId,f.next))return 'failed link';
 const original=diag.loadHistoryStore().cycles;
 const archive=archivePayload(original);
 delete memory[key];
 const review=diag.reviewHistoryImport(archive);
 const imported=review.ok&&diag.commitHistoryImport(archive,review.currentRaw);
 const stored=diag.loadHistoryStore().cycles;
 const parent=stored.find(c=>c.cycleId===f.parentId),child=stored.find(c=>c.parentCycleId===f.parentId);
 const resumed=child&&diag.resumeCycle(child.cycleId);
 const active=child&&diag.saveHistory({cycleId:child.cycleId,mode:'build',
   answers:child.answers,result:child.result,
   experimentPlan:{...child.experimentPlan,status:'ACTIVE'},cycleStatus:'ACTIVE'});
 const followup=child&&diag.startFollowupForCycle(child.cycleId);
 return String(imported&&review.newCount===2&&stored.length===2&&
  parent?.nextCycleId===child?.cycleId &&
  parent?.initialDiagnosisSnapshot.resultId===f.firstId&&
  resumed&&active&&followup&&s.followupBase.result.resultId===child.initialDiagnosisSnapshot.resultId);
}),['true']);
add('HANDOFF-SECOND-CLICK-NO-NEW-CHILD','P1','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'double');
 const once=diag.startLinkedCycle(f.parentId,f.next);
 const raw=memory[key];
 const twice=diag.startLinkedCycle(f.parentId,f.next);
 return String(once&&!twice&&memory[key]===raw&&diag.loadHistoryStore().cycles.length===2);
}),['true']);
add('HANDOFF-WRITE-ERROR-ROLLBACK','P0','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'quota');
 const old=memory[key],id=s.activeCycleId,previous=localStorageMock.setItem;
 localStorageMock.setItem=()=>{throw Error('storage quota')};
 let saved;
 try{saved=diag.startLinkedCycle(f.parentId,f.next)}finally{localStorageMock.setItem=previous}
 return String(!saved&&memory[key]===old&&s.activeCycleId===id&&
   diag.loadHistoryStore().cycles.length===1);
}),['true']);
add('HANDOFF-BAD-PARENT-NO-CHANGES','P0','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'missing');
 const old=memory[key],ok=diag.startLinkedCycle('cycle_missing',f.next);
 return String(!ok&&memory[key]===old);
}),['true']);
add('HANDOFF-RESUME-THEN-NEW-CYCLE','P1','HISTORY',()=>isolatedHistory(key=>{
 const f=setupHandoff(key,'resumed');
 const saved=diag.saveHistory({cycleId:f.parentId,mode:'followup',
  answers:{...s.answers},result:f.fu,cycleStatus:'COMPLETED'});
 const resumed=diag.resumeCycle(f.parentId);
 const linked=diag.startLinkedCycle(f.parentId,f.next);
 const cs=diag.loadHistoryStore().cycles;
 return String(saved&&resumed&&linked&&cs.length===2&&
  cs.find(c=>c.cycleId===f.parentId)?.followups.length===1);
}),['true']);


add('HANDOFF-REAL-FOLLOWUP-BUTTON-HANDLER','P0','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const f=setupHandoff(key,'ui_event');
 const before=diag.loadHistoryStore().cycles.find(c=>c.cycleId===f.parentId);
 diag.finalizeFollowup();
 const result=s.result;
 const el=documentMock.getElementById('resultNext');
 const link=(el.afterNodes||[]).at(-1);
 if(!result.followup || !result.stateTransition?.nextResult || !link) return 'button missing / '+result.followupCode+' / '+result.stateTransition?.type;
 await uiFire(link,'click');
 const cs=diag.loadHistoryStore().cycles;
 const p=cs.find(c=>c.cycleId===f.parentId), child=cs.find(c=>c.parentCycleId===f.parentId);
 return String(cs.length===2&&p.result.followup===true&&p.followups.length===1&&
 p.status==='COMPLETED'&&p.nextCycleId===child?.cycleId&&
 p.initialDiagnosisSnapshot.resultId===f.firstId);
}),['true']);


/* Keyboard focus contract via actual UI event handlers; native browser still required. */
add('A11Y-HOME-TITLE-FOCUS','P1','ACCESSIBILITY',()=>{
 const h=documentMock.getElementById('homeTitle');h.focused=false;
 diag.showHome();return String(h.focused===true&&h['tabindex']==='-1');
},['true']);
add('A11Y-NEW-QUESTION-HEADING-FOCUS','P1','ACCESSIBILITY',()=>{
 const h=documentMock.getElementById('questionTitle');h.focused=false;
 diag.startMode('full');return String(h.focused===true&&h['tabindex']==='-1'&&!!h.textContent);
},['true']);
add('A11Y-OPTION-FOCUS-PRESERVED','P1','ACCESSIBILITY',async()=>{
 diag.startMode('full');
 const area=documentMock.getElementById('answerArea');
 const pick=area.children.at(-1);
 await uiFire(pick,'click');
 const advanced=s.index===1&&s.path[s.index]==='scope_name'&&
   documentMock.getElementById('nextButton').hidden===false;
 const back=documentMock.getElementById('backButton');
 // DOM mock retains superseded listeners; click only the handler on the visible page.
 back._events.click.at(-1)();
 const latest=area.children.slice(-diag.questions.scope_goal.options.length);
 return String(advanced&&s.index===0&&
   latest.some(x=>x['aria-pressed']==='true')&&
   documentMock.getElementById('nextButton').hidden===true);
},['true']);
add('A11Y-NEXT-TEXT-INPUT-FOCUS','P1','ACCESSIBILITY',()=>{
 diag.startMode('full');s.answers.scope_goal=diag.questions.scope_goal.options[0].value;
 diag.goNext();
 const input=documentMock.getElementById('answerArea').children.at(-1);
 return String(s.path[s.index]==='scope_name'&&input?.focused===true&&
  input?.['aria-labelledby']==='questionTitle');
},['true']);
add('A11Y-BACK-RESTORES-HEADING-FOCUS','P1','ACCESSIBILITY',()=>{
 diag.startMode('full');s.answers.scope_goal=diag.questions.scope_goal.options[0].value;
 diag.goNext();
 const heading=documentMock.getElementById('questionTitle');heading.focused=false;
 const back=documentMock.getElementById('backButton');
 back._events.click.at(-1)();
 return String(s.index===0&&heading.focused===true&&heading['tabindex']==='-1');
},['true']);
add('A11Y-RESULT-HEADING-FOCUS','P1','ACCESSIBILITY',()=>isolatedHistory(key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 reset('build',{scope_name:'Тест',scope_goal:'new_sales',scope_model:'PRODUCT'});
 s.parentCycleId=null;
 const r=diag.makeResult('BUILD_MARKET_TEST');
 const stored=diag.saveHistory({mode:'build',scope:'Тест',answers:s.answers,result:r,cycleStatus:'DIAGNOSED'});
 const h=documentMock.getElementById('resultTitle');h.focused=false;
 const resumed=stored&&diag.resumeCycle(s.activeCycleId);
 return String(resumed&&h.focused===true&&h['tabindex']==='-1');
}),['true']);
add('A11Y-MAIN-NO-WHOLE-SCREEN-LIVE','P2','ACCESSIBILITY',()=>
 String(html.includes('<main id="app" class="app"></main>')&&
 !html.includes('id="app" class="app" aria-live="polite"')),['true']);
add('A11Y-NARROW-WRAP-CONTRACT','P2','ACCESSIBILITY',()=>
 String(html.includes('.wizard-actions button { min-width: 0; }')&&
 html.includes('overflow-wrap: anywhere;')),['true']);


/* FOLLOW-UP planned time, budget, exposure caps: optional and enforceable. */
function capScenario({caps={},answers={}}={}) {
 reset('followup',{fu_done:'yes',fu_guardrail:['none'],fu_execution_match:'no',
   fu_sample_ready:'not_yet',...answers});
 s.followupBase={
   result:{primaryCode:'ACCESS',userTitle:'Привлечение',diagnosticMode:'full',
      experimentPlan:{experimentId:'cap_example',primaryCode:'ACCESS',...caps}},
   experimentPlan:{experimentId:'cap_example',primaryCode:'ACCESS',...caps}
 };
 return diag.classifyFollowup();
}
add('CAP-NO-LIMITS-LEGACY-CONTINUES','P1','FOLLOWUP',()=>{
 const result=capScenario();
 return result.code+'|'+result.decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|CONTINUE']);
add('CAP-REACHED-BUDGET-STOPS-EXTENSION','P0','FOLLOWUP',()=>{
 const result=capScenario({caps:{budgetCap:1500},answers:{fu_limit_status:'yes'}});
 return result.code+'|'+result.decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|REDESIGN']);
add('CAP-REACHED-EXPOSURE-STOPS-EXTENSION','P0','FOLLOWUP',()=>{
 const result=capScenario({caps:{exposureCap:50},answers:{fu_limit_status:'yes'}});
 return result.decision;
},['REDESIGN']);
add('CAP-NOT-HIT-YET-CONTINUES','P1','FOLLOWUP',()=>{
 const result=capScenario({caps:{budgetCap:1500},answers:{fu_limit_status:'no'}});
 return result.decision;
},['CONTINUE']);
add('CAP-UNKNOWN-AND-N-LOW-DO-NOT-CONTINUE','P1','FOLLOWUP',()=>{
 const result=capScenario({caps:{exposureCap:30,plannedObservationCount:20},
   answers:{fu_limit_status:'unknown',fu_sample_ready:'yes',fu_observed_count:10,
    fu_measurement_valid:'yes',fu_effect:'better'}});
 return result.code+'|'+result.decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|REDESIGN']);
add('CAP-DAYS-ELAPSED-AUTO-STOPS-EXTENSION','P0','FOLLOWUP',()=>{
 const result=capScenario({caps:{timeCap:7,startedAt:'2020-01-01T00:00:00.000Z'},
   answers:{fu_limit_status:'no'}});
 return result.code+'|'+result.decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|REDESIGN']);
add('CAP-VALID-SUCCESS-DESPITE-CAP','P1','FOLLOWUP',()=>{
 const result=capScenario({caps:{budgetCap:1000,plannedObservationCount:5},
   answers:{fu_limit_status:'yes',fu_sample_ready:'yes',fu_observed_count:5,
    fu_measurement_valid:'yes',fu_effect:'better'}});
 return result.code+'|'+result.decision;
},['FOLLOWUP_CONFIRMED|CONFIRM']);
add('CAP-GUARDRAIL-OVERRIDES-LIMIT','P0','FOLLOWUP',()=>{
 const result=capScenario({caps:{budgetCap:1000},
   answers:{fu_limit_status:'yes',fu_guardrail:['money']}});
 return result.code+'|'+result.decision;
},['FOLLOWUP_GUARDRAIL_FAIL|ROLLBACK']);
add('CAP-ROUTE-ASKS-ONLY-WHEN-PLANNED','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{budgetCap:500}};
 s.path=['fu_done','fu_guardrail'];s.index=1;
 diag.goNext();
 const withCap=s.path[2];
 reset('followup',{fu_done:'yes',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{}};
 s.path=['fu_done','fu_guardrail'];s.index=1;
 diag.goNext();
 return withCap+'|'+s.path[2];
},['fu_limit_status|fu_execution_match']);
add('CAP-ROUTE-AFTER-LIMIT-CONTINUES-TO-CLEANLINESS','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_guardrail:['none'],fu_limit_status:'yes'});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{timeCap:7}};
 s.path=['fu_done','fu_guardrail','fu_limit_status'];s.index=2;diag.goNext();
 return s.path[3];
},['fu_execution_match']);
add('CAP-PLAN-HAS-OPTIONAL-UI','P1','FOLLOWUP',()=>{
 reset('build',{scope_goal:'launch',scope_model:'PRODUCT'});
 const result=diag.makeResult('BUILD_MARKET_TEST');
 const plan=diag.experimentPlanFor(result);
 return String(plan && plan.timeCap===null && plan.budgetCap===null&&plan.exposureCap===null &&
  html.includes('id="experimentTimeCap"') && html.includes('id="experimentBudgetCap"') &&
  html.includes('id="experimentExposureCap"'));
},['true']);
add('CAP-MEASURED-N-LOW-WHILE-CAP-HIT','P0','FOLLOWUP',()=>{
 const result=capScenario({caps:{budgetCap:2000,plannedObservationCount:12},
   answers:{fu_limit_status:'yes',fu_sample_ready:'yes',fu_observed_count:4,
     fu_measurement_valid:'yes',fu_effect:'better'}});
 return result.decision+'|'+result.code;
},['REDESIGN|FOLLOWUP_INSUFFICIENT_EVIDENCE']);


add('CAP-UI-INPUTS-SAVE-RESUME-HISTORY','P0','FOLLOWUP-UI',()=>isolatedHistory(key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 reset('build',{scope_goal:'new_sales',scope_name:'Цветы',scope_model:'PRODUCT'});
 s.parentCycleId=null;
 const first=diag.makeResult('BUILD_MARKET_TEST');
 first.diagnosticMode='build';
 first.experimentPlan=diag.experimentPlanFor(first);
 const prepared=diag.saveHistory({mode:'build',scope:'Цветы',answers:{...s.answers},
   result:first,experimentPlan:first.experimentPlan,cycleStatus:'PLANNED'});
 const parentId=s.activeCycleId;
 const resumed=prepared&&diag.resumeCycle(parentId);
 if(!resumed)return 'resume_failed';
 for(const [id,value] of [['experimentTimeCap','14'],['experimentBudgetCap','1500'],['experimentExposureCap','40']]){
   const input=documentMock.getElementById(id);
   input.value=value;
   const fn=input._events?.input?.at(-1);
   if(!fn)return 'input_missing_'+id;
   fn();
 }
 const start=documentMock.getElementById('startExperimentButton');
 const activate=start._events?.click?.at(-1);
 if(!activate)return 'activate_missing';
 activate();
 const stored=diag.loadHistoryStore().cycles.find(c=>c.cycleId===parentId);
 const limits=stored?.experimentPlan;
 const reentered=diag.startFollowupForCycle(parentId);
 return String(stored?.status==='ACTIVE' && limits?.timeCap===14 &&
   limits?.budgetCap===1500 && limits?.exposureCap===40 &&
   limits?.startedAt && reentered &&
   s.followupBase.experimentPlan.budgetCap===1500);
}),['true']);
add('CAP-INPUT-INVALID-REFUSED','P1','FOLLOWUP-UI',()=>isolatedHistory(key=>{
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[],activeCycleIds:[]});
 reset('build',{scope_goal:'new_sales',scope_model:'PRODUCT',scope_name:'Тест'});
 s.parentCycleId=null;
 const result=diag.makeResult('BUILD_MARKET_TEST');
 result.diagnosticMode='build';result.experimentPlan=diag.experimentPlanFor(result);
 diag.saveHistory({mode:'build',scope:'Тест',answers:{...s.answers},
   result,experimentPlan:result.experimentPlan,cycleStatus:'PLANNED'});
 diag.resumeCycle(s.activeCycleId);
 const values=[['experimentTimeCap','0'],['experimentBudgetCap','-2'],['experimentExposureCap','1.5']];
 for(const [id,v] of values){
   const input=documentMock.getElementById(id);
   input.value=v;input._events?.input?.at(-1)?.();
 }
 const plan=s.result?.experimentPlan;
 return String(plan?.timeCap===null&&plan?.budgetCap===null&&plan?.exposureCap===null);
}),['true']);
add('CAP-ROUTE-STOP-WHEN-NOT-ENOUGH-AND-EXPIRED','P0','FOLLOWUP',()=>{
 const old=new Date(Date.now()-4*86400000).toISOString();
 const outcome=capScenario({caps:{timeCap:3,startedAt:old},
  answers:{fu_limit_status:'no',fu_sample_ready:'not_yet'}});
 return outcome.code+'|'+outcome.decision;
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|REDESIGN']);
add('CAP-LEGACY-PLAN-NO-CAP-EXTRA-Q','P1','FOLLOWUP',()=>{
 reset('followup',{fu_done:'yes',fu_guardrail:['none']});
 s.followupBase={result:{primaryCode:'ACCESS'},experimentPlan:{plannedObservationCount:20}};
 s.path=['fu_done','fu_guardrail'];s.index=1;diag.goNext();
 return String(!s.path.includes('fu_limit_status')&&s.path[2]==='fu_execution_match');
},['true']);


/* Regression for owner-reported history and Follow-up UX */
add('OWNER-HIST-SCOPE-NO-OBJECT','P1','HISTORY-UI',()=>isolatedHistory(key=>{
 const c=archiveFixture('cycle_owner1','owner1',null,{scope:{name:'Букеты',diagnosticMode:'build'}});
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 diag.showHome();
 return String(!!uiFind(n=>n.textContent?.includes('Букеты · создана')) &&
 !uiFind(n=>n.textContent?.includes('[object Object]')));
}),['true']);
add('OWNER-HIST-FIRST-SECOND-DATETIME','P1','HISTORY-UI',()=>isolatedHistory(key=>{
 const old=archiveFixture('cycle_ownerold','ownerold',null,{createdAt:'2026-10-11T08:00:00Z',updatedAt:'2026-10-11T10:00:00Z'});
 const young=archiveFixture('cycle_owneryoung','owneryoung',null,{createdAt:'2026-10-12T09:00:00Z',updatedAt:'2026-10-12T11:00:00Z'});
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[young,old],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 diag.showHome();
 return String(!!uiFind(n=>n.textContent?.startsWith('Диагностика №1:'))&&
  !!uiFind(n=>n.textContent?.startsWith('Диагностика №2:'))&&
  !!uiFind(n=>n.textContent?.includes('создана 11.10.2026')&&n.textContent?.includes('обновлена')));
}),['true']);
add('OWNER-HIST-LINKED-CHILD-INDICATOR','P1','HISTORY-UI',()=>isolatedHistory(key=>{
 const p=archiveFixture('cycle_ownerparent','ownerparent',null,{createdAt:'2026-10-11T08:00:00Z'});
 const c=archiveFixture('cycle_ownerchild','ownerchild',null,{parentCycleId:p.cycleId,createdAt:'2026-10-12T08:00:00Z'});
 p.nextCycleId=c.cycleId;p.followups=[{followupId:'fu_owner'}];
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c,p],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 diag.showHome();
 return String(!!uiFind(n=>n.textContent==='Продолжение диагностики №1')&&
 !!uiFind(n=>n.textContent==='Повторных проверок результата: 1'));
}),['true']);
add('OWNER-HIST-WIPE-ALL-ACTIVE-AND-LEGACY','P0','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const c=archiveFixture('cycle_owneractive','owneractive',null,{status:'ACTIVE'});
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[c.cycleId]});
 const legacyKey='salesDiagnosticHistoryV1',prev=memory[legacyKey];
 memory[legacyKey]=JSON.stringify([]);
 const promptBefore=windowMock.prompt;windowMock.prompt=()=> 'УДАЛИТЬ';
 try{
  diag.showHome();
  await uiFire(uiFind(n=>n.textContent==='Очистить всю историю…'),'click');
  return String(diag.loadHistoryStore().cycles.length===0 &&
   diag.loadHistoryStore().legacyMigratedAt && memory[legacyKey]===undefined &&
   !uiFind(n=>n.textContent==='Очистить всю историю…') &&
   !!uiFind(n=>n.textContent?.includes('Вся история очищена')));
 }finally{
  windowMock.prompt=promptBefore;
  if(prev===undefined)delete memory[legacyKey];else memory[legacyKey]=prev;
 }
}),['true']);
add('OWNER-HIST-WIPE-PROMPT-CANCEL-NO-CHANGE','P0','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const c=archiveFixture('cycle_ownercancel','ownercancel',null,{status:'ACTIVE'});
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[c.cycleId]});
 const raw=memory[key],old=windowMock.prompt;windowMock.prompt=()=> '';
 try{
  diag.showHome();await uiFire(uiFind(n=>n.textContent==='Очистить всю историю…'),'click');
  return String(memory[key]===raw&&diag.loadHistoryStore().cycles.length===1);
 }finally{windowMock.prompt=old}
}),['true']);
add('OWNER-HIST-WIPE-CONFIRM-CANCEL-NO-CHANGE','P0','HISTORY-UI',async()=>isolatedHistory(async key=>{
 const c=archiveFixture('cycle_ownerrefuse','ownerrefuse');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[]});
 const raw=memory[key],old=windowMock.confirm;windowMock.confirm=()=> false;
 try{
  diag.showHome();await uiFire(uiFind(n=>n.textContent==='Очистить всю историю…'),'click');
  return String(memory[key]===raw);
 }finally{windowMock.confirm=old}
}),['true']);
add('OWNER-HIST-WIPE-QUOTA-FAIL-NO-CHANGE','P0','HISTORY',()=>isolatedHistory(key=>{
 const c=archiveFixture('cycle_ownerquota','ownerquota');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[]});
 const raw=memory[key],old=localStorageMock.setItem;localStorageMock.setItem=()=>{throw Error('quota')};
 let ok;try{ok=diag.clearAllHistory()}finally{localStorageMock.setItem=old}
 return String(!ok&&memory[key]===raw&&diag.loadHistoryStore().cycles.length===1);
}),['true']);
add('OWNER-HIST-INVALID-STORAGE-PROTECTED','P0','HISTORY',()=>isolatedHistory(key=>{
 memory[key]='{bad json';
 return String(!diag.clearAllHistory()&&memory[key]==='{bad json');
}),['true']);
add('OWNER-FU-EMPTY-AND-NEXT-NO-DUPLICATE','P1','RESULT-UI',()=>isolatedHistory(key=>{
 const c=archiveFixture('cycle_ownerfollow','ownerfollow');
 c.result={...c.result,followup:true,proven:'',boundary:'',userTitle:'Пока мало данных',
 userSummary:'Достигнут предел',next:'Выберите новый план.',
 nextIfSuccess:'Выберите новый план.',nextIfFailure:'Выберите новый план.',
 observationRule:'Выберите новый план.',
 action:'Пересмотрите условия.',why:['Прошлый вывод: оформление','Достигнут лимит','Что делать дальше: новый план.']};
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 const before=documentMock.getElementById('resultWhy').children.length;
 const opened=diag.resumeCycle(c.cycleId);
 const reasons=documentMock.getElementById('resultWhy').children.slice(before).map(n=>n.textContent);
 const copied=diag.resultText(c.result);
 return String(opened&&documentMock.getElementById('resultMeaningCard').hidden&&
 documentMock.getElementById('resultDecisionCard').hidden&&
 documentMock.getElementById('resultObservationBox').hidden&&
 reasons.length===2&&copied.split('Выберите новый план.').length===2&&
 documentMock.getElementById('resultNext').textContent==='Выберите новый план.');
}),['true']);
add('OWNER-HIST-RESET-THEN-IMPORT-BACKUP','P0','HISTORY',()=>isolatedHistory(key=>{
 const c=archiveFixture('cycle_ownerrestore','ownerrestore');
 memory[key]=JSON.stringify({schemaVersion:2,cycles:[c],activeCycleIds:[],legacyMigratedAt:'2026-10-12'});
 const backup=archivePayload([c]);
 const empty=diag.clearAllHistory();
 const check=diag.reviewHistoryImport(backup);
 const imported=check.ok&&diag.commitHistoryImport(backup,check.currentRaw);
 return String(empty&&imported&&check.newCount===1&&
 diag.loadHistoryStore().cycles[0]?.cycleId===c.cycleId);
}),['true']);


/* Stage 13 owner acceptance: plain-language questions must preserve routing and meaning. */
add('OWNER-LANG-STOPPED-KEEPS-FULL','P0','LANG',()=>{
 reset('full',{scope_goal:'new_sales',scope_name:'Букеты',scope_model:'PRODUCT',scope_target:'completed_orders',maturity_state:'stopped'},['maturity_state']);
 diag.goNext();
 return String(s.mode==='full'&&s.path.includes('scope_period')&&s.path.includes('gate_legal'));
},['true']);
add('OWNER-LANG-CHANGED-KEEPS-HYBRID','P0','LANG',()=>{
 reset('full',{scope_goal:'new_sales',scope_name:'Букеты',scope_model:'PRODUCT',scope_target:'completed_orders',maturity_state:'changed'},['maturity_state']);
 diag.goNext();
 return String(s.mode==='hybrid'&&s.path.includes('inheritance_entry'));
},['true']);
add('OWNER-LANG-MATURITY-CHOICES','P1','LANG',()=>{
 const options=diag.questions.maturity_state.optionsFn(s);
 return String(options.length===5&&
 options.find(o=>o.value==='repeatable')?.label==='Да, продаю регулярно'&&
 options.find(o=>o.value==='stopped')?.hint.includes('примерно прежними')&&
 options.find(o=>o.value==='changed')?.hint.includes('только число заказов'));
},['true']);
add('OWNER-LANG-CORE-PLAIN-RUSSIAN','P1','LANG',()=>{
 s.answers.scope_name='Букеты';s.answers.scope_model='PRODUCT';
 return String(diag.questions.maturity_state.title(s).startsWith('Вы уже продаёте')&&
 diag.questions.gate_legal.title.startsWith('Есть ли у вас сомнения')&&
 diag.questions.core_access.title(s).startsWith('Как часто новые люди спрашивают')&&
 diag.questions.gate_capacity.title(s).includes('сможете выполнить')&&
 diag.questions.deep_c1.title(s).startsWith('Что мешает покупателю'));
},['true']);
add('OWNER-LANG-RESULT-PLAIN-INSTRUCTIONS','P1','LANG',()=>{
 return String(html.includes('Как проверить, поможет ли это действие')&&
 html.includes('Сколько времени и денег готовы потратить на проверку')&&
 html.includes('История остаётся в этом браузере')&&
 html.includes('Проблем не замечаю'));
},['true']);


add('OWNER-COUNTS-CHECKOUT-CLEAR-BASELINE','P1','LANG',()=>{
 const x=diag.experimentNumericCopy('PURCHASE_FRICTION',{label:'завершённых оформлений',denominator:'людей, решивших купить'});
 return String(
   x.before.includes('завершили оформление заказа')&&
   x.denominator.includes('явно хотели купить')&&
   x.example.includes('20 человек')&&x.example.includes('6 завершили')&&
   x.planned.includes('ПОСЛЕ изменения')&&x.plannedHelp.includes('упрощение оформления')&&
   x.description.includes('ДО того')&&x.description.includes('поля пустыми')
 );
},['true']);
add('OWNER-COUNTS-OTHER-BUSINESS-DYNAMIC','P1','LANG',()=>{
 const x=diag.experimentNumericCopy('SUB_RENEWAL',{label:'состоявшихся продлений',denominator:'участников с наступившим сроком продления'});
 return String(x.before.includes('состоявшихся продлений')&&
 x.denominator.includes('участников с наступившим сроком')&&
 x.planned.includes('участников с наступившим сроком')&&
 !x.example.includes('оформление заказа'));
},['true']);
add('OWNER-COUNTS-BROWSER-PRIVACY-CAVEAT','P1','LANG',()=>{
 return String(html.includes('не появляется автоматически на других устройствах')&&
 html.includes('перенести через экспорт и импорт файла')&&
 !html.includes('Все данные хранятся только на вашем устройстве и недоступны'));
},['true']);
add('OWNER-COUNTS-INTERFACE-LABELS','P1','LANG',()=>{
 return String(html.includes('id="experimentMetricBeforeLabel"')&&
 html.includes('id="experimentNumericExample"')&&
 html.includes('id="experimentPlannedCountLabel"')&&
 html.includes('id="experimentDenominatorHelp"')&&
 html.includes('Какое действие будем проверять')&&
 !html.includes('Для доли нужны оба числа: число событий'));
},['true']);


/* Owner finding: a completed but unsuccessful intervention must offer
   one grounded next investigation, and a linkable cycle, not a dead end. */
function failedFollowupFixture(code='ACCESS',clue='at_step',effect='same') {
 reset('followup',{
   fu_done:'yes',fu_guardrail:['none'],fu_execution_match:'no',
   fu_sample_ready:'yes',fu_measurement_valid:'yes',
   fu_effect:effect,fu_failure_location:clue
 });
 s.followupBase={
   answers:{scope_goal:'new_sales',scope_model:'PRODUCT',gate_legal:'no'},
   result:{primaryCode:code,diagnosticMode:'full',userTitle:'Первоначальная проблема'},
   experimentPlan:{primaryCode:code,changeOneThing:'Первое действие',experimentId:'failed_test'}
 };
 return diag.classifyFollowup();
}
add('OWNER-FAIL-NEXT-QUESTION-ROUTE','P1','FOLLOWUP',()=>{
 failedFollowupFixture('ACCESS','before');
 s.path=['fu_effect'];s.index=0;
 diag.goNext();
 return s.path.join('|');
},['fu_effect|fu_failure_location']);
add('OWNER-FAIL-SAME-RESULT-PRODUCES-NEXT','P1','FOLLOWUP',()=>{
 const classified=failedFollowupFixture('PURCHASE_FRICTION','at_step');
 const next=diag.buildStateTransition(classified).nextResult;
 return String(classified.code==='FOLLOWUP_FAILED' &&
   next?.experimentPlan?.planType==='EVIDENCE_COLLECTION' &&
   next?.experimentPlan?.nonCommercialOnly===true &&
   next?.primaryCode==='PURCHASE_FRICTION' &&
   next?.action.includes('обращени') &&
   next?.action!==diag.experimentPlanFor(next).changeOneThing &&
   next?.confidence==='PRELIMINARY');
},['true']);
add('OWNER-FAIL-DIFFERENT-CLUES-DIFFERENT-ACTIONS','P1','FOLLOWUP',()=>{
 const before=diag.followupFailureAdvice('ACCESS','before').action;
 const during=diag.followupFailureAdvice('ACCESS','at_step').action;
 const after=diag.followupFailureAdvice('ACCESS','after').action;
 const money=diag.followupFailureAdvice('ECONOMICS','at_step').action;
 const delivery=diag.followupFailureAdvice('FULFILLMENT','at_step').action;
 const unknown=diag.followupFailureAdvice('SUB_RENEWAL','unknown').action;
 return String(new Set([before,during,after,money,delivery,unknown]).size===6 &&
   money.includes('расход') && delivery.includes('сбо') &&
   unknown.includes('клиент'));
},['true']);
add('OWNER-FAIL-HARM-NO-UNSAFE-NEW-CYCLE','P0','FOLLOWUP',()=>{
 failedFollowupFixture('ACCESS','at_step');
 s.answers.fu_guardrail=['money'];
 const cls=diag.classifyFollowup(),trans=diag.buildStateTransition(cls);
 return cls.code+'|'+String(trans.nextResult===null);
},['FOLLOWUP_GUARDRAIL_FAIL|true']);
add('OWNER-FAIL-MISSING-SAMPLE-NO-NEW-CYCLE','P1','FOLLOWUP',()=>{
 failedFollowupFixture('ACCESS','at_step');
 s.answers.fu_sample_ready='not_yet';
 const cls=diag.classifyFollowup(),trans=diag.buildStateTransition(cls);
 return cls.code+'|'+String(trans.nextResult===null);
},['FOLLOWUP_INSUFFICIENT_EVIDENCE|true']);
add('OWNER-FAIL-NUMERIC-CONTRADICTION-SKIPS-RECHECK','P1','FOLLOWUP',()=>{
 failedFollowupFixture('PURCHASE_FRICTION','after','same');
 s.followupBase.experimentPlan.primaryMetricBefore=3;
 s.followupBase.experimentPlan.primaryMetricDenominatorBefore=10;
 s.answers.fu_numeric_after=8;
 s.answers.fu_numeric_denominator_after=10;
 s.path=['fu_effect'];s.index=0;diag.goNext();
 return String(!s.path.includes('fu_failure_location'));
},['true']);
add('OWNER-FAIL-RESULT-PLAIN-CTA','P1','UX',()=>String(
 html.includes("'Открыть следующий шаг'") &&
 html.includes('fu_failure_location') &&
 html.includes('Предыдущее действие не улучшило главный результат.')),['true']);


add('STAGE14-HEADER-CONFIRMS-UNSAVED-ANSWERS','P1','UX',()=>{
 const previousConfirm=windowMock.confirm;
 try {
   reset('full',{scope_goal:'new_sales'},['scope_goal','scope_name']);s.index=1;
   const header=nodes.get('resetButton');
   if(!header?._events?.click?.length)return 'no handler';
   let asked=0;
   windowMock.confirm=()=>{asked++;return false;};
   header._events.click[0]();
   const preserved=s.mode==='full'&&s.answers.scope_goal==='new_sales'&&s.index===1;
   windowMock.confirm=()=>true;
   header._events.click[0]();
   return String(preserved&&asked===1&&s.mode===null&&Object.keys(s.answers).length===0);
 }finally{windowMock.confirm=previousConfirm;}
},['true']);


add('STAGE14-CONFIRM-UNSAVED-RESULT','P1','UX',()=>{
 const previousConfirm=windowMock.confirm;
 try {
   reset('full',{scope_name:'Несохранённый результат',scope_goal:'new_sales',scope_model:'PRODUCT'});
   s.path=[]; s.result=diag.makeResult('ACCESS');
   const originalId=s.result.resultId;
   const goHome=nodes.get('resetButton')._events.click[0];
   let asked=0;
   windowMock.confirm=()=>{asked++;return false;};
   goHome();
   const kept=s.result?.resultId===originalId;
   windowMock.confirm=()=>true;
   goHome();
   return String(kept&&asked===1&&s.result===null&&s.mode===null);
 }finally{windowMock.confirm=previousConfirm;}
},['true']);
add('STAGE14-COPIED-PLAN-INCLUDES-NUMBERS-LIMITS','P1','UX',()=>{
 const r={title:'Проверка заказа',why:['Факт из заказов'],action:'Исправить оформление',
   confidence:'PRELIMINARY',metrics:['Сколько купили'],holdConstant:['Цена'],
   observationRule:'После 20 обращений',next:'Вернитесь к проверке',
   experimentPlan:{changeOneThing:'Один шаг оформления',executionSteps:['Изменить кнопку заказа','Посчитать заявки'],
     primaryMetric:'Оформленные покупки',primaryMetricBefore:6,
     primaryMetricDenominatorBefore:20,plannedObservationCount:25,
     timeCap:14,budgetCap:1500,exposureCap:50,nonCommercialOnly:false,status:'PLANNED'}};
 const copied=diag.resultText(r);
 return String(['План проверки:','Изменить кнопку заказа','6 из 20 случаев',
  '25','14 дней','1500 ₽','50 человек'].every(w=>copied.includes(w)));
},['true']);

const regressionRun=(async()=>{
 const failures=[];
 for (const t of tests) {
  let got;
  try { got=await t.run(); } catch(e) { got='ERROR:' + e.message; }
  if(!t.allowed.includes(got))failures.push({id:t.id,priority:t.priority,group:t.group,got,allowed:t.allowed});
 }
 const summary={total:tests.length,pass:tests.length-failures.length,fail:failures.length,
 p0:failures.filter(x=>x.priority==='P0').length,p1:failures.filter(x=>x.priority==='P1').length};
 console.log(JSON.stringify(summary,null,2));
 if(failures.length) {
  failures.forEach(x=>console.error(x.id+' '+x.priority+' ['+x.group+'] got='+x.got+' expected='+x.allowed.join('|')));
  process.exitCode=1;
 } else console.log('REGRESSION PASS');
})();
regressionRun.catch(e=>{console.error(e);process.exitCode=1;});