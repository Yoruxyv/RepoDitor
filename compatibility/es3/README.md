# ES3 compatibility evidence

`known-vector.json` is the product-neutral compatibility oracle for RepoDitor's
Desktop and Web ES3 implementations. It contains only synthetic deterministic
test data: a plaintext JSON value, fixed test IV, and its expected encrypted
container.

The fixed IV is exclusively a test fixture. Production encryption must generate
a fresh random IV. Update this vector only when verified evidence shows that the
observed R.E.P.O./ES3 container contract changed.

`run-mutations.json` supplies synthetic Run saves and expected Health, resume,
and exact-instance refill results for the Desktop and Web tests. Both suites
reopen encrypted output and compare the full decoded Run, including other players,
unrelated item charges, and opaque fields. Desktop exercises its save transaction
and Web exercises verified export.
