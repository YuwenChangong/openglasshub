import pg from "pg";
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { parseP9Connection } from "../p9-readonly-postgres-transport.mjs";
import { fail,catalogConnectionFailure } from "./catalog-production-migration-transport.mjs";

export async function prepareCatalogConnection({environment=process.env}={}) {
  let parsed;
  try{parsed=parseP9Connection({mode:"PRODUCTION",dsn:environment.P9_PRODUCTION_DATABASE_URL});}catch{fail("STAGE_B_CONNECTION_SOURCE_INVALID");}
  if(parsed.safeTarget.endpointClass!=="SUPAVISOR_SESSION")fail("STAGE_B_SESSION_POOLER_REQUIRED");
  let ca;
  try{ca=await readFile(environment.P9_PRODUCTION_DATABASE_CA_CERT_PATH,"utf8");const blocks=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)??[];if(!blocks.length||ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,"").trim())throw new Error();for(const block of blocks)new X509Certificate(block);}catch{fail("STAGE_B_CA_TRUST_INVALID");}
  const e=parsed.pgEnv;
  return {host:e.PGHOST,port:Number(e.PGPORT),user:e.PGUSER,password:e.PGPASSWORD,database:e.PGDATABASE,ssl:{ca,rejectUnauthorized:true,servername:e.PGHOST},connectionTimeoutMillis:10000,statement_timeout:30000,lock_timeout:5000,query_timeout:35000,application_name:"catalog-stage-b-migration"};
}
export function createCatalogPostgresAdapter({config,Client=pg.Client}) {
  let opened=false;
  return async()=>{
    if(opened)fail("STAGE_B_RECONNECT_FORBIDDEN");opened=true;
    const client=new Client(config);let broken=false;
    client.on?.("error",()=>{broken=true;});
    try{await client.connect();}catch(error){try{await client.end();}catch{}throw catalogConnectionFailure(error);}
    return {
      async query(text,values=[],timeout=30000){if(broken)fail("STAGE_B_CONNECTION_LOST");return client.query({text,values,query_timeout:timeout});},
      async close(){try{await client.end();}catch{fail("STAGE_B_CONNECTION_CLOSE_FAILED");}},
    };
  };
}
