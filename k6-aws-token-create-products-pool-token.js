import http from 'k6/http';
import { check, group } from 'k6';
import exec from 'k6/execution';
import { PerformanceFramework } from './k6-framework-processor-pool-token.js';

export const options = {
    scenarios: {
        constant_request_rate: {
            executor: 'constant-arrival-rate',
            rate: 2,             // 2 iterations per 10s = 0.2 TPS (Adjust as needed)
            timeUnit: '10s',
            duration: '10m',
            preAllocatedVUs: 5,  // Increased to match your 5-10 users
            maxVUs: 10,
        },
    },
};

const CONFIG = {
    baseUrl: 'https://aa.execute-api.us-east-2.amazonaws.com/pp',
    tokenUrl: 'https://us-east.auth.us-east-2.amazoncognito.com/oauth2/token',
    apiKey: 'asasas',
    expirySeconds: 300,
    renewBefore: 60,
};

const pf = new PerformanceFramework();

// 1. Load the pool of 5-10 credentials from CSV
const authPool = pf.loadAuthPool('./auth_creds.csv');

export default function () {
    // 2. Each VU picks its own credentials from the pool
    // (exec.vu.idInTest starts at 1, so we subtract 1 for array index)
    const userCreds = authPool[(exec.vu.idInTest - 1) % authPool.length];

    // 3. Get token using this VU's specific credentials
    const token = pf.getToken(CONFIG, userCreds);

    const synthetic_data = pf.generateSynthetic();

    group('CREATE Product', () => {
        const price = Math.floor(500 + Math.random() * 500);
        const payload = JSON.stringify({
            productId: synthetic_data.uuid,
            name: synthetic_data.fullName,
            category: 'Electronics',
            price: price,
        });

        const headers = {
            Authorization: `Bearer ${token}`,
            'x-api-key': CONFIG.apiKey,
            'Content-Type': 'application/json',
        };

        const res = http.post(`${CONFIG.baseUrl}/products`, payload, { headers });

        check(res, { 'CREATE success': r => r.status === 200 || r.status === 201 });

        if (pf.isValid(res)) {
            pf.writeCsv(
                ['productId', 'status', 'user', 'price', 'timestamp'],
                [synthetic_data.uuid, res.status, userCreds.clientId, price, new Date().toISOString()]
            );
        }
    });

    pf.pause(0.5, 1.5);

}
