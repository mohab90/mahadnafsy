-- Four clients could not log in with their own email address.
--
-- Their subscribers.email is stored with a leading space — ' name@gmail.com' —
-- so the login lookup, which compares the typed address to the stored one, never
-- matched. The account exists, the password reset exists, and neither is
-- reachable: the response is the same "Invalid credentials" an unknown address
-- gets, because as far as the query is concerned the address IS unknown.
--
-- Found by attempting a login as each kind of client against production and
-- reading the guidance that came back. The phone-only path answered correctly;
-- the email path answered nothing, and the stored value showed why.
--
-- The write paths already trim (routes/admin/subscribers.js does it in four
-- places, and the import panel normalises every cell), so this is legacy data
-- from an import that did not. Trimming it is the whole fix — no code change
-- would be right here, because a lookup that wraps the column in TRIM() stops
-- using the index on it and makes every login a table scan.
--
-- Idempotent: the WHERE clause matches nothing on a database already clean, and
-- running it twice changes nothing. On production it touches 4 rows.
UPDATE subscribers SET email = TRIM(email)
 WHERE email IS NOT NULL AND email <> TRIM(email);

-- Same treatment for the other contact columns and the other table, so a value
-- that arrived padded cannot hide an account anywhere it is looked up by.
-- All are no-ops on production today; they are here so this migration states the
-- rule rather than only the one instance of it that was found.
UPDATE subscribers SET phone = TRIM(phone)
 WHERE phone IS NOT NULL AND phone <> TRIM(phone);

UPDATE users SET email = TRIM(email)
 WHERE email IS NOT NULL AND email <> TRIM(email);

UPDATE users SET phone = TRIM(phone)
 WHERE phone IS NOT NULL AND phone <> TRIM(phone);

UPDATE leads SET email = TRIM(email)
 WHERE email IS NOT NULL AND email <> TRIM(email);

UPDATE leads SET phone = TRIM(phone)
 WHERE phone IS NOT NULL AND phone <> TRIM(phone);
