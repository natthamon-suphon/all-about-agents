# Systematic-debugging fixtures

These shell fixtures are disposable inputs for the `find-polluter.sh`
feedback loop. They intentionally include a filename containing a space so
the loop can prove that path boundaries are preserved. `fixture-runner.sh` is
an executable-path runner: it takes exactly one argument, the test file, which
is how `find-polluter.sh` calls any runner that is not a package manager. The
lint test copies them into a temporary directory and sets `POLLUTION_TARGET`
to a disposable path; they never touch repository state by themselves.
