# Reference API repository guidelines

- This is an autonomous nestjs heavy reference fixture.
- Preserve the 10 routes and successful responses in README.md.
- Keep /health immediate; /slow waits exactly 80 seconds. Mock sleep in routine tests.
- Keep Light and its private mirror tree-identical; visibility is the only difference.
- Pin direct dependencies. Do not add secrets, customer Dockerfiles, cloud resources,
  generated handlers or APIZIT-internal dependencies.
- Run the checks in CONTRIBUTING.md, then publish through a codex/ branch and PR with green CI.
- Hosted support must follow the platform qualification evidence. Do not claim a
  successful launch until the exact source revision has been verified in dev.
