-- Synthetic fixture only: snapshot before additive single-book migration.
create table public.book_original_data as select public.pilot_preserved_data() as records;
