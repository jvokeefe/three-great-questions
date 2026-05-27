import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gnjbyvacijqsanbnenws.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gZAVL8ZMIE9OEnmwPj5jaQ_lQoFN4fu';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);