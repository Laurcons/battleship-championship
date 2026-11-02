import { Badge, Button, Card, Col, ListGroup, Row, Table } from 'react-bootstrap';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';
import { Loading } from '../components/ErrorAlert';
import { RulesetDetails } from '../components/RulesetDetails';
import { useRulesets } from '../hooks/queries';
import { Markdown } from '../components/Markdown';
import { DOC_PAGES, EXAMPLES, EXAMPLES_README, PROTOCOL_VERSIONS } from '../docs';

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExamplesPage() {
  return (
    <>
      <Markdown source={EXAMPLES_README} />
      {EXAMPLES.map((ex) => (
        <section key={ex.slug} className="mb-4" data-testid={`example-${ex.slug}`}>
          <div className="d-flex align-items-center gap-2 mb-2">
            <h2 className="h5 m-0">{ex.title}</h2>
            <span className="mono small text-body-secondary">{ex.filename}</span>
            <span className="ms-auto d-flex gap-2">
              <CopyButton text={ex.source} />
              <Button size="sm" variant="outline-secondary" onClick={() => download(ex.filename, ex.source)}>
                <i className="bi bi-download me-1" aria-hidden="true" />
                Download
              </Button>
            </span>
          </div>
          <pre className="mono small bg-body border rounded p-3" style={{ maxHeight: 420, overflow: 'auto' }} tabIndex={0} aria-label={`${ex.title} example source`}>
            <code>{ex.source}</code>
          </pre>
        </section>
      ))}
    </>
  );
}

function RulesetsPage() {
  const page = DOC_PAGES.find((p) => p.slug === 'rulesets');
  const rulesets = useRulesets();
  return (
    <>
      <Markdown source={page?.source ?? ''} />
      <h2 className="h4 mt-4">Available rulesets</h2>
      {rulesets.isLoading && <Loading />}
      <div className="d-grid gap-3" data-testid="rulesets-list">
        {rulesets.data?.filter((r) => r.enabled).map((r) => (
          <Card key={r.ruleset.id} data-testid="ruleset-card" data-ruleset={r.ruleset.id}>
            <Card.Body>
              <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                <h3 className="h5 m-0 mono">{r.ruleset.id}</h3>
                {r.isDefault && (
                  <Badge bg="info" className="text-dark">
                    default for new lobbies
                  </Badge>
                )}
              </div>
              <p className="small">{r.ruleset.description}</p>
              <RulesetDetails ruleset={r.ruleset} testId={`ruleset-details-${r.ruleset.id}`} />
            </Card.Body>
          </Card>
        ))}
      </div>
    </>
  );
}

function ProtocolPage() {
  const page = DOC_PAGES.find((p) => p.slug === 'protocol');
  return (
    <>
      <h2 className="h5">Protocol versions</h2>
      <Table size="sm" className="mb-4" data-testid="protocol-versions">
        <thead>
          <tr>
            <th>Version</th>
            <th>Endpoint</th>
            <th>Status</th>
            <th>JSON Schemas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {PROTOCOL_VERSIONS.map((v) => (
            <tr key={v.version}>
              <td>v{v.version}</td>
              <td className="mono">{v.path}</td>
              <td>{v.status}</td>
              <td>
                <ul className="list-unstyled small m-0" data-testid={`schemas-v${v.version}`}>
                  {v.schemas.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} target="_blank" rel="noopener">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="small text-body-secondary">{v.note}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Markdown source={page?.source ?? ''} />
    </>
  );
}

export function DocsPage() {
  const slug = useParams()['*'] || '';
  const nav = [...DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title })), { slug: 'examples', title: 'Examples' }];
  if (!slug) return <Navigate to="/docs/getting-started" replace />;
  const page = DOC_PAGES.find((p) => p.slug === slug);
  return (
    <Row className="g-4">
      <Col md={3} lg={2}>
        <ListGroup as="nav" aria-label="Documentation" className="position-sticky" style={{ top: '1rem' }}>
          {nav.map((n) => (
            <ListGroup.Item key={n.slug} as={NavLink} to={`/docs/${n.slug}`} action>
              {n.title}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Col>
      <Col md={9} lg={10}>
        {slug === 'examples' ? (
          <ExamplesPage />
        ) : slug === 'protocol' ? (
          <ProtocolPage />
        ) : slug === 'rulesets' ? (
          <RulesetsPage />
        ) : page ? (
          <Markdown source={page.source} />
        ) : (
          <p className="text-body-secondary">This documentation page does not exist.</p>
        )}
      </Col>
    </Row>
  );
}
