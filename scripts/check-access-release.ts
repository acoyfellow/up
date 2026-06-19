import { readFile } from 'node:fs/promises';
import { type AccessApplicationSnapshot, validateAccessRelease } from './lib/access-release';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const snapshotPath = required('UP_ACCESS_APPLICATION_FILE');
const document = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
  result?: AccessApplicationSnapshot;
} & AccessApplicationSnapshot;
const app = document.result || document;
const errors = validateAccessRelease(app, {
  applicationId: required('UP_EXPECTED_ACCESS_APP_ID'),
  identityProviderId: required('UP_EXPECTED_ACCESS_IDP'),
  emailDomain: required('UP_EXPECTED_EMAIL_DOMAIN'),
  controlHost: required('UP_CONTROL_HOST'),
});

if (errors.length) {
  console.error('Access release guard failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  'Access release guard passed: employee-only policy, reviewed IdP, and protected routes.',
);
