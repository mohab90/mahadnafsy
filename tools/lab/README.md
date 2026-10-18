# The performance and journey lab

A private copy of the panel at production scale, with **synthetic** data (no real client) and the real API on top.
Never load a production backup into it. How to build and run it is in `tools/seed-synthetic-load.cjs`; the quick path
(files here assume the lab database lives in `D:/audit_tmp/perf-db`, see the memory note «performance-lab»):

- `lab-up.sh` — start the private MariaDB (:3397) and the API (:3401, `start-api.sh`), log in every role into `cj_<user>.txt`.
- `sweep.cjs <repo> <user>` — GET every parameterless `/api/admin` endpoint as one account: status, time, size.
- `sweep_student.cjs` — the same for the student-facing `/api/me` routes.
- `journeys.cjs [public|money|lead]`, `journeys_hr.cjs`, `journeys_money2.cjs` — do something as one account, then look
  for the result everywhere a person would look («written here, not shown there»).
- `roundtrip.cjs`, `sub_rt.cjs` — save an entity with every field set, read it back, report what vanished.

The scripts read the cookie files and the paths they were written for (`D:/audit_tmp/perf-db`); edit the constants at
the top when the lab lives elsewhere.
