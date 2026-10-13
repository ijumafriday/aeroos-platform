import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.ACCESS_TOKEN;
const OPERATOR = __ENV.OPERATOR || '';
const VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || '15m';
if (!TOKEN) throw new Error('ACCESS_TOKEN is required');

const headers = { authorization: `Bearer ${TOKEN}` };
if (OPERATOR) headers['x-operator'] = OPERATOR;

export const options = {
  scenarios: {
    airline_mixed_read: {
      executor: 'ramping-vus',
      startVUs: Math.max(5, Math.floor(VUS / 10)),
      stages: [
        { duration: '2m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '2m', target: 0 }
      ],
      gracefulRampDown: '30s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1200', 'p(99)<3000'],
    'http_req_duration{domain:ops}': ['p(95)<1200'],
    'http_req_duration{domain:maintenance}': ['p(95)<1500'],
    'http_req_duration{domain:supply}': ['p(95)<1500'],
    'http_req_duration{domain:search}': ['p(95)<1200']
  }
};

const reads = [
  ['/api/me', 'platform'],
  ['/api/notifications', 'platform'],
  ['/api/ops/timeline', 'ops'],
  ['/api/ops/airports', 'ops'],
  ['/api/ops/dispatch', 'ops'],
  ['/api/ops/roster', 'crew'],
  ['/api/camo/fleet', 'maintenance'],
  ['/api/camo/work-packages', 'maintenance'],
  ['/api/camo/due', 'airworthiness'],
  ['/api/camo/health/engines', 'engineering'],
  ['/api/amo/stores', 'supply'],
  ['/api/amo/supply/orders?scope=open', 'supply'],
  ['/api/amo/supply/logistics/transfers', 'supply'],
  ['/api/records', 'records'],
  ['/api/engineering/configuration/baselines', 'engineering'],
  ['/api/search?q=aircraft', 'search']
];

export default function () {
  const [path, domain] = reads[Math.floor(Math.random() * reads.length)];
  const res = http.get(`${BASE_URL}${path}`, { headers, tags: { domain, operation: path.split('?')[0] } });
  check(res, { 'request accepted': r => r.status === 200 || r.status === 204 });
  sleep(Math.random() * 0.8 + 0.2);
}
