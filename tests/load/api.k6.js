import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.ACCESS_TOKEN;
const OPERATOR = __ENV.OPERATOR || '';
if (!TOKEN) throw new Error('ACCESS_TOKEN is required');

export const options = {
  scenarios: {
    steady_reads: { executor: 'ramping-vus', startVUs: 5, stages: [{ duration: '2m', target: 50 }, { duration: '5m', target: 50 }, { duration: '2m', target: 0 }] }
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1000', 'p(99)<2500']
  }
};

const headers = { authorization: `Bearer ${TOKEN}` };
if (OPERATOR) headers['x-operator'] = OPERATOR;

export default function () {
  const me = http.get(`${BASE_URL}/api/me`, { headers, tags: { operation: 'me' } });
  check(me, { 'me 200': r => r.status === 200 });
  const notifications = http.get(`${BASE_URL}/api/notifications`, { headers, tags: { operation: 'notifications' } });
  check(notifications, { 'notifications 200': r => r.status === 200 });
  sleep(0.2);
}
