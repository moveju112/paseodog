import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createMixdogProvider } from './server/provider.js';
export default function contribute(server: PluginServerContext) {
    server.registerProvider(createMixdogProvider());
    return () => {};
}
