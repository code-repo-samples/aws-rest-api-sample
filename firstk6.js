import http from 'k6/http';
import { sleep, group, check } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/2.4.0/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

// 1. Custom Trends (These appear as rows in the "Summary" tab table)
const homeDuration = new Trend('duration_home');
const pizzaDuration = new Trend('duration_pizza');
const recsDuration = new Trend('duration_recs');

export const options = {
    stages: [
        { duration: '1m', target: 2 }, 
        // { duration: '1m', target: 4 }, 
        // { duration: '1m', target: 0 }, 
    ],
    thresholds: {
        // 2. Dashboard "Labels": This forces the xk6-dashboard to show 
        // separate lines/labels for each group in the "Timings" charts.
        'http_req_duration{group:::01_Home_Page}': ['max>=0'],
        'http_req_duration{group:::02_Get_Pizza}': ['max>=0'],
        'http_req_duration{group:::03_Get_Recommendations}': ['max>=0'],

        // 2. Your actual pass/fail criteria
        'http_req_duration': ['p(99)<3000'],
        'http_req_failed': ['rate<0.7'],
    }
};

export default function () {
    group('01_Home_Page', function () {
        const res = http.get('https://quickpizza.grafana.com/');
        check(res, { 'status is 200': (r) => r.status === 200 });
        
        // Record the Total Response Time
        homeDuration.add(res.timings.duration);
    });

    sleep(1);

    group('02_Get_Pizza', function () {
        const res = http.get('https://quickpizza.grafana.com/api/pizza-invalid');
        check(res, { 'status is 200': (r) => r.status === 200 });
        console.error("Error");
        pizzaDuration.add(res.timings.duration);
    });

    sleep(1);

    group('03_Get_Recommendations', function () {
        const res = http.get('https://httpbin.test.k6.io/delay/1'); 
        check(res, { 'status is 200': (r) => r.status === 200 });
        
        recsDuration.add(res.timings.duration);
    });
}

// 4. Summary Handler: Ensures you get a local HTML file AND terminal output
export function handleSummary(data) {
  console.log("Preparing to write summary reports...");
  return {
    "summary.html": htmlReport(data),
    "stdout": textSummary(data, { indent: " ", enableColors: false }),
  };
}
