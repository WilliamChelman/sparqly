- matt pocock skills + setup (already ran)
- talk about /grill-me (unibiquitous cool skill)
- showcase /grill-me-with-doc (not too deep, answer yes to everything)
  - see created PRD on github (it can be local .md file)
- showcase to-issues (not to the end) -> show existing issues
- showcase a /tdd run
- green field vs. brown field (monkey see, monkey do)
  - need strong steering if starting from scratch
- something cool: semantic diff of 2 .ttl files

```md
/grill-with-docs I want to implement a "describe" page on the webapp, that would:

- show all the triples/quads a uri is linked to, either as a subject or an object
- triples would be pulled from every sources configured
- a user should be able to restrict the sources used for the describe ([0..n])
- we should handle rdf star too on this page
- also need to pull blank node chains
```

Questions:

1. Making sure what describes mean (usual Describe query on each source, tailored CBD - Concise Bounded Description, ...)
2. Boundaries and depth of CBD (follow blank node, direct or symmetrical, rdf star handling)
3. Multi-source aggregation: where? (frontend vs. backend, api signature, ...)
4. per-source provenance: sidecar map, rdf star, highjack graph name (no)
5. render policy of provenance rdf star (since it is what I chose)
6. How describe algorithm hits various sources (native descrive, custom queries, files vs. remote, ...)
7. Some UX questions (source selector, webapp url, ...)
8. CLI parity and error handling per source (partial failures reporting or full stop, ...)
9. minor question about configuration
10. Potential pagination and/or streaming
11. iri field behavior
12. results rendering (table, turtle/trig, ...)
13. Loading UX
14. bnode ux + counts (beware of dedups etc.0)

Done ADR was written + CONTEXT.md update for "vocabulary" alignment

/to-prd in the same convo:

- proposed module split
- main testing targets
- create github issue (can be local .md too)

clear the chat (long enough)
