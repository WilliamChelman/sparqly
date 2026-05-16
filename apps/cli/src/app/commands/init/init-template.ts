export const INIT_TEMPLATE_YAML = `# sparqly configuration
# Run \`sparqly query\` / \`sparqly serve\` from this directory (or any sub-directory)
# to use this file. Auto-discovery walks up to the nearest .git.

# Declare each source you want to query. Add an entry below, then drop the
# enclosing list-bracket [] when you do — \`sources:\` becomes a YAML list.
sources: []

# --- example: a glob of local RDF files ---
# sources:
#   - id: docs
#     glob: data/**/*.ttl
#     # splitByFile exposes each matched file as @docs/<relative-path>, in
#     # addition to @docs (the union). Drop it to keep the union only.
#     splitByFile: true

# --- example: a remote SPARQL endpoint ---
# sources:
#   - id: wikidata
#     endpoint: https://query.wikidata.org/sparql

# --- example: serve options (used by \`sparqly serve\`) ---
# serve:
#   port: 3000
#   watch: false

# --- example: prefixes used in CLI output and the web UI ---
# context:
#   prefixes:
#     rdf: http://www.w3.org/1999/02/22-rdf-syntax-ns#
#     rdfs: http://www.w3.org/2000/01/rdf-schema#
#     owl: http://www.w3.org/2002/07/owl#
#     xsd: http://www.w3.org/2001/XMLSchema#
#     ex: https://example.org/
`;
