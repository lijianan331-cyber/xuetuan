-- Original amount + optional explicit currency. NULL preserves the historical inference.
-- No old amounts, ownership, visibility policies or existing data are rewritten.
alter table public.visits add column price_currency text
  check (price_currency is null or price_currency in
    ('MYR','CNY','HKD','MOP','SGD','AUD','USD','CAD','GBP','EUR','JPY','KRW','THB','IDR','TWD'));
grant update (price_currency) on public.visits to authenticated;
notify pgrst, 'reload schema';
