# Systematic-debugging fixtures

These shell fixtures are disposable inputs for the `find-polluter.sh`
feedback loop. They intentionally include a filename containing a space so
the loop can prove that path boundaries are preserved. Run them only from a
temporary copy with `POLLUTION_TARGET` set to a disposable path; they never
touch repository state by themselves.
