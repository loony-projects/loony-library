-- Sign-in moved to the shared "Sign in with Loony" account pool, where people
-- have new loony-auth accounts (and so new subjects). Accounts from before the
-- move are marked here and re-linked once, on first sign-in, to the Loony
-- account with the same verified email, keeping their role and reading data.
alter table users add column relink_by_email boolean not null default false;
update users set relink_by_email = true where auth_subject is not null;
