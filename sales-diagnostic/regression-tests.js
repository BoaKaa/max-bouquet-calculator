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
    remove(){}, after(){}, addEventListener(){},
    setAttribute(k,v){ this[k]=v; },
    cloneNode(){ return node(id + '_clone'); },
    focus(){},
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
},['fu_effect|fu_market_payment|fu_guardrail']);
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

const failures=[];
for (const t of tests) {
  let got;
  try { got=t.run(); } catch (e) { got='ERROR:' + e.message; }
  if (!t.allowed.includes(got)) failures.push({id:t.id,priority:t.priority,group:t.group,got,allowed:t.allowed});
}
const summary={total:tests.length,pass:tests.length-failures.length,fail:failures.length,p0:failures.filter(x=>x.priority==='P0').length,p1:failures.filter(x=>x.priority==='P1').length};

console.log(JSON.stringify(summary,null,2));
if (failures.length) {
  failures.forEach(x=>console.error(x.id+' '+x.priority+' ['+x.group+'] got='+x.got+' expected='+x.allowed.join('|')));
  process.exitCode=1;
} else {
  console.log('REGRESSION PASS');
}
