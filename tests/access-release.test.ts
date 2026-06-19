import { describe, expect, it } from 'vitest';
import {
  type AccessApplicationSnapshot,
  validateAccessRelease,
} from '../scripts/lib/access-release';

const expectation = {
  applicationId: 'app-id',
  identityProviderId: 'employee-saml',
  emailDomain: 'cloudflare.com',
  controlHost: 'up.example.com',
};

function safeApplication(): AccessApplicationSnapshot {
  return {
    id: 'app-id',
    name: 'up',
    allowed_idps: ['employee-saml'],
    auto_redirect_to_identity: true,
    destinations: [
      { type: 'public', uri: 'up.example.com/app' },
      { type: 'public', uri: 'up.example.com/api' },
    ],
    policies: [
      {
        name: 'Employees',
        decision: 'allow',
        include: [{ email_domain: { domain: 'cloudflare.com' } }],
        exclude: [],
        require: [],
      },
    ],
    enable_binding_cookie: true,
    http_only_cookie_attribute: true,
    same_site_cookie_attribute: 'lax',
  };
}

describe('Access release guard', () => {
  it('accepts the reviewed employee-only boundary', () => {
    expect(validateAccessRelease(safeApplication(), expectation)).toEqual([]);
  });

  it('rejects Everyone, bypass policies, unreviewed IdPs, and missing protected routes', () => {
    const app = safeApplication();
    app.allowed_idps = ['one-time-pin'];
    app.destinations = [{ type: 'public', uri: 'up.example.com/app' }];
    app.policies = [
      { name: 'Public demo', decision: 'allow', include: [{ everyone: {} }] },
      { name: 'Bypass', decision: 'bypass', include: [{ everyone: {} }] },
    ];

    expect(validateAccessRelease(app, expectation)).toEqual(
      expect.arrayContaining([
        'Access must allow only the reviewed identity provider',
        'Access policy must never include Everyone',
        'Access policy must never bypass authentication',
        'Allow policy must be limited to @cloudflare.com',
        'Access destination is missing: up.example.com/api',
      ]),
    );
  });
});
