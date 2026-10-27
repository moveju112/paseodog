import test from 'node:test';
import { runSharedAppTests } from './shared-app-tests.mjs';

test('shared host picker switches root host while the gear still opens settings', () =>
    runSharedAppTests(['src/components/left-sidebar.test.tsx']));
