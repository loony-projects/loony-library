begin;

-- Sign-in moved to loony-auth: users are identified by the loony-auth
-- subject (`sub` claim), not by a local password. Existing local accounts
-- can no longer sign in, so their sessions are cleared.
alter table users add column auth_subject text unique;
alter table users drop column password_hash;
alter table users drop constraint users_email_key;
delete from sessions;

commit;
