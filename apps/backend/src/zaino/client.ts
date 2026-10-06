import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { recordUpstream } from '../lib/metrics';
import path from 'path';

const ZAINO_URL  = process.env.ZAINO_GRPC_URL || '';
const ZAINO_ADDR = ZAINO_URL.replace(/^https?:\/\//, '');

const PROTO_PATH = path.join(__dirname, '../../proto/service.proto');

let _client: grpc.Client | null = null;

function apiKeyInterceptor(
  options: grpc.InterceptorOptions,
  nextCall: grpc.NextCall,
) {
  // Every call is timed for the sysop's Metrics app (lib/metrics).
  const method = String(options.method_definition?.path ?? 'unknown').split('/').pop() ?? 'unknown';
  const t0 = Date.now();
  return new grpc.InterceptingCall(nextCall(options), {
    start(metadata: grpc.Metadata, listener: grpc.Listener, next: Function) {
      if (process.env.ZAINO_GRPC_API_KEY) {
        metadata.set('x-api-key', process.env.ZAINO_GRPC_API_KEY);
      }
      // a partial listener: grpc-js supplies the pass-through for everything else
      next(metadata, {
        onReceiveStatus: (status: grpc.StatusObject, nextStatus: (s: grpc.StatusObject) => void) => {
          recordUpstream('zaino', method, Date.now() - t0, status.code === grpc.status.OK);
          nextStatus(status);
        },
      });
    },
  });
}

function client(): any {
  if (_client) return _client;

  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase:  true,
    longs:     String,
    enums:     String,
    defaults:  true,
    oneofs:    true,
  });

  const proto = grpc.loadPackageDefinition(pkgDef) as Record<string, any>;
  const Ctor  = proto?.cash?.z?.wallet?.sdk?.rpc?.CompactTxStreamer as typeof grpc.Client;

  if (!Ctor) throw new Error('CompactTxStreamer not found in proto');

  const creds = ZAINO_URL.startsWith('https://')
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();

  _client = new Ctor(ZAINO_ADDR, creds, { interceptors: [apiKeyInterceptor] });
  return _client;
}

export async function getLightdInfo(): Promise<{
  chainName: string;
  blockHeight: string;
  saplingActivationHeight: string;
  vendor: string;
  zcashdSubversion: string;
}> {
  return new Promise((resolve, reject) => {
    client().GetLightdInfo({}, (err: grpc.ServiceError, res: any) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

export type ActiveNode = 'zebra' | 'zakura' | 'zcashd' | 'unknown';

/**
 * Determine which node architecture is currently serving data.
 *
 * Zaino answers from whichever full node it is connected to, so the node's
 * self-reported subversion / vendor string (e.g. "/Zebra:6.2.2/", "/Zakura:.../")
 * reflects the live node. An explicit ACTIVE_NODE env var overrides detection
 * for cases where the string is ambiguous or a manual pin is desired.
 */
export function nodeFromSubversion(subversion?: string, vendor?: string): ActiveNode {
  const s = `${subversion ?? ''} ${vendor ?? ''}`.toLowerCase();
  if (s.includes('zakura')) return 'zakura';
  if (s.includes('zebra')) return 'zebra';
  if (s.includes('magicbean') || s.includes('zcashd')) return 'zcashd';
  return 'unknown';
}

export async function detectActiveNode(): Promise<{ node: ActiveNode; subversion: string; source: 'env' | 'node' }> {
  const override = process.env.ACTIVE_NODE?.toLowerCase();
  if (override === 'zebra' || override === 'zakura' || override === 'zcashd') {
    return { node: override, subversion: `(pinned via ACTIVE_NODE)`, source: 'env' };
  }
  const info = await getLightdInfo();
  return {
    node: nodeFromSubversion(info.zcashdSubversion, info.vendor),
    subversion: info.zcashdSubversion || info.vendor || '',
    source: 'node',
  };
}

export async function getLatestBlock(): Promise<{ height: string; hash: Buffer }> {
  return new Promise((resolve, reject) => {
    client().GetLatestBlock({}, (err: grpc.ServiceError, res: any) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

export async function getAddressUtxos(
  addresses: string[],
  startHeight = 0,
  maxEntries  = 200,
): Promise<Array<{ address: string; txid: Buffer; valueZat: number; height: string }>> {
  return new Promise((resolve, reject) => {
    client().GetAddressUtxos(
      { addresses, startHeight, maxEntries },
      (err: grpc.ServiceError, res: any) => {
        if (err) reject(err);
        else resolve(res?.addressUtxos ?? []);
      },
    );
  });
}

export async function getTaddressTransactions(
  address: string,
  startHeight: number,
  endHeight:   number,
): Promise<Array<{ data: Buffer; height: string }>> {
  return new Promise((resolve, reject) => {
    const txs: any[] = [];
    const stream = client().GetTaddressTransactions({
      address,
      range: { start: { height: startHeight }, end: { height: endHeight } },
    });
    stream.on('data',  (tx: any) => txs.push(tx));
    stream.on('end',   () => resolve(txs));
    stream.on('error', (err: Error) => reject(err));
  });
}
