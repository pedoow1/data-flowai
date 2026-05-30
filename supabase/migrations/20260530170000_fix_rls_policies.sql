-- Fix RLS policies and add comprehensive security

-- Create a helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT true FROM public.user_roles
    WHERE user_roles.user_id = is_admin.user_id AND role = 'admin'
  ), false);
$$;

-- Alternative admin check using email
CREATE OR REPLACE FUNCTION public.is_admin_email(email_text text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT email_text = 'abdalahkotp31@gmail.com';
$$;

-- Drop existing policies on uploads if they cause issues
DROP POLICY IF EXISTS "users read own uploads" ON public.uploads;
DROP POLICY IF EXISTS "users insert own uploads" ON public.uploads;
DROP POLICY IF EXISTS "admins read all uploads" ON public.uploads;

-- Recreate uploads policies with better admin check
CREATE POLICY "users read own uploads" ON public.uploads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users insert own uploads" ON public.uploads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins read all uploads" ON public.uploads
  FOR SELECT USING (public.is_admin(auth.uid()));

-- Fix extract function RLS by allowing users to call via service role
-- This ensures the extract operations work properly
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_email(text) TO authenticated;
