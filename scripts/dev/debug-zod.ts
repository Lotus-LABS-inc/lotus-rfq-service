
import { execSync } from 'child_process';
import fs from 'fs';

try {
    const output = execSync('npx vitest run test/integration/sor-build-and-run.integration.test.ts --reporter=json', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    console.log('Tests passed unexpectedly');
} catch (err: any) {
    const data = JSON.parse(err.stdout);
    const testResults = data.testResults[0].assertionResults;
    const errors: any[] = [];
    for (const res of testResults) {
        if (res.status === 'failed') {
            errors.push({
                test: res.fullName,
                message: res.failureMessages[0]
            });
        }
    }
    fs.writeFileSync('full_zod_errors.json', JSON.stringify(errors, null, 2));
    console.log('Wrote errors to full_zod_errors.json');
}
