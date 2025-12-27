
import { createClient } from '@supabase/supabase-js'
import { Database } from './types/database.types';

export const getDB = (sbkey: string) => {
    const supabaseUrl = 'https://jlhwsrgsgdubxtcgieli.supabase.co'
    const supabaseKey = sbkey;
    const supabase = createClient<Database>(supabaseUrl, supabaseKey)

    return supabase;
} 