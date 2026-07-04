// Supplemental OpenAPI CSV examples for routes whose handlers live outside
// analytics-routes.mjs. Kept in a dedicated module so parallel CSV PRs can add
// examples without contending on the csvExampleForRoute if-chain in contracts.mjs.
export const ROUTE_CSV_EXAMPLES = {
  "subnet-yield": [
    "uid,hotkey,role,stake_tao,emission_tao,yield,vs_median",
    "0,hk_sample,validator,1000,22.1,0.0221,above",
  ].join("\r\n"),
  "subnet-neuron-history": [
    "snapshot_date,captured_at,block_number,uid,hotkey,coldkey,active,validator_permit,rank,trust,validator_trust,consensus,incentive,dividends,emission_tao,stake_tao,registered_at_block,is_immunity_period,axon",
    "2026-06-02,2026-06-02T00:00:00.000Z,8454388,0,hk_sample,ck_sample,true,true,1,0.5,0.99,0.4,0.1,0.2,22.1,1000.5,6702485,false,1.2.3.4:8091",
  ].join("\r\n"),
  "subnet-history": [
    "snapshot_date,neuron_count,validator_count,total_stake_tao,total_emission_tao",
    "2026-06-02,256,32,125000.5,42.1",
  ].join("\r\n"),
  "account-history": [
    "day,netuid,event_count,event_kinds,first_block,last_block",
    "2026-06-02,7,12,StakeAdded;Transfer,8454300,8454388",
  ].join("\r\n"),
  "subnet-uptime": [
    "surface_id,day,samples,uptime_ratio,avg_latency_ms,latency_sample_count,p50_latency_ms,p95_latency_ms,p99_latency_ms,status",
    "subnet-7-rpc,2026-06-02,1440,0.9986,42,1200,38,55,72,ok",
  ].join("\r\n"),
};
