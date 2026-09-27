import { buildNetworkAuditReport, remoteOrigin } from './network-audit';

describe('network audit', () => {
    test('ignores non-network and local development URLs', () => {
        expect(remoteOrigin('file:///tmp/index.html')).toBeNull();
        expect(remoteOrigin('http://localhost:4200')).toBeNull();
        expect(remoteOrigin('http://127.0.0.1:3000/v2/payments/test')).toBeNull();
    });

    test('normalizes remote requests to origins', () => {
        expect(remoteOrigin('https://guardrail.branta.pro/v2/payments/test'))
            .toBe('https://guardrail.branta.pro');
        expect(remoteOrigin('https://fonts.googleapis.com/css2?family=Roboto'))
            .toBe('https://fonts.googleapis.com');
    });

    test('reports only hosts outside the explicit allowlist', () => {
        const report = buildNetworkAuditReport([
            'https://guardrail.branta.pro/v2/payments/abc',
            'https://fonts.googleapis.com/css2?family=Roboto',
            'https://tracker.example/collect',
            'https://tracker.example/second-call'
        ]);
        expect(report.observedOrigins).toEqual([
            'https://fonts.googleapis.com',
            'https://guardrail.branta.pro',
            'https://tracker.example'
        ]);
        expect(report.unexpectedOrigins).toEqual(['https://tracker.example']);
    });
});
