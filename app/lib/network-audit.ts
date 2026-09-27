export const DEFAULT_ALLOWED_NETWORK_HOSTS = [
    'guardrail.branta.pro',
    'staging.branta.pro',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

export type NetworkAuditReport = {
    observedOrigins: string[];
    unexpectedOrigins: string[];
    allowedHosts: string[];
};

export function remoteOrigin(rawUrl: string): string | null {
    let parsed: URL;

    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return null;
    }

    return parsed.origin;
}

export function buildNetworkAuditReport(
    urls: Iterable<string>,
    allowedHosts: Iterable<string> = DEFAULT_ALLOWED_NETWORK_HOSTS
): NetworkAuditReport {
    const allow = new Set(Array.from(allowedHosts, host => host.trim().toLowerCase()).filter(Boolean));
    const observed = new Set<string>();

    for (const rawUrl of urls) {
        const origin = remoteOrigin(rawUrl);
        if (origin) {
            observed.add(origin);
        }
    }
    const observedOrigins = Array.from(observed).sort();
    const unexpectedOrigins = observedOrigins.filter(origin => {
        const hostname = new URL(origin).hostname.toLowerCase();
        return !allow.has(hostname);
    });

    return {
        observedOrigins,
        unexpectedOrigins,
        allowedHosts: Array.from(allow).sort()
    };
}
