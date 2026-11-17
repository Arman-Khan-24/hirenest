-- Add vendor_charge_pct to requirements (FTE only, nullable)
alter table public.requirements
  add column if not exists vendor_charge_pct numeric(5,2) check (vendor_charge_pct is null or (vendor_charge_pct >= 0 and vendor_charge_pct <= 100));

comment on column public.requirements.vendor_charge_pct is 'Vendor placement fee as percentage of CTC for FTE hires. Visible to vendors and admins only.';
