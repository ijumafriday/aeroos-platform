import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.ACCESS_TOKEN;
const OPERATOR = __ENV.OPERATOR || '';
const VUS = Number(__ENV.VUS || 75);
const DURATION = __ENV.DURATION || '4h';
if (!TOKEN) throw new Error('ACCESS_TOKEN is required');
const headers = { authorization: `Bearer ${TOKEN}` };
if (OPERATOR) headers['x-operator'] = OPERATOR;

export const options = {
  scenarios: { soak: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '30s' } },
  thresholds: {
    http_req_failed: ['rate<0.0025'],
    http_req_duration: ['p(95)<1200', 'p(99)<3000']
  }
};

const reads = [
  '/api/me', '/api/notifications', '/api/ops/timeline', '/api/ops/dispatch', '/api/camo/fleet',
  '/api/camo/work-packages', '/api/amo/stores', '/api/records', '/api/search?q=aircraft'
];
export default function () {
  const path = reads[Math.floor(Math.random() * reads.length)];
  const res = http.get(`${BASE_URL}${path}`, { headers });
  check(res, { '2xx': r => r.status >= 200 && r.status < 300 });
  sleep(Math.random() * 1.5 + 0.5);
}
