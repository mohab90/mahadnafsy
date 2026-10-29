-- An expense now says which box (خزنة) the money left (29 Oct 2026).
--
-- «عند اضافه مصروف لازم يكون اختيار الخزنة اللى هصرف منها الفلوس». The box balances (lib/boxBalances.js) were payments in,
-- less withdrawals; an expense never reduced any box. box_method is the box's name as the boxes screen carries it (the channel
-- after lib/paymentChannels.js and the aliases). NULL on every expense recorded before this: they left no box that anyone
-- recorded, so they keep not touching one.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS box_method VARCHAR(191) NULL DEFAULT NULL;
