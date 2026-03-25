import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
	console.error('[retention] Missing SUPABASE_URL/VITE_SUPABASE_URL or service role key.');
	process.exit(1);
}

const client = createClient(url, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await client.rpc('run_retention_cleanup');

if (error) {
	console.error('[retention] cleanup failed:', error.message);
	process.exit(1);
}

console.info('[retention] cleanup ok:', JSON.stringify(data));
