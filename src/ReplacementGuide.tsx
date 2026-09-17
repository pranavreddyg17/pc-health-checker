import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CircleHelp,
  PackageCheck,
  Plus,
  ShieldCheck,
  TriangleAlert,
} from './ui/Glyphs';
import type { Scan } from './shared/types';
import { CATALOG_VERSION, products } from './shared/catalog';
import { assessReplacement } from './shared/replacements';

export default function ReplacementGuide({
  scan,
  initialComponentId,
}: {
  scan?: Scan;
  initialComponentId?: string;
}) {
  const [componentId, setComponentId] = useState(
    initialComponentId ?? scan?.components.find((c) => c.kind === 'storage')?.id ?? '',
  );
  const [showCatalog, setShowCatalog] = useState(!scan);
  useEffect(() => {
    setComponentId(
      scan?.components.find((c) => c.id === initialComponentId)?.id ??
        scan?.components.find((c) => c.kind === 'storage')?.id ??
        scan?.components[0]?.id ??
        '',
    );
    setShowCatalog(!scan);
  }, [scan?.id, initialComponentId]);
  const selected = scan?.components.find((c) => c.id === componentId);
  const assessment = selected ? assessReplacement(selected, scan!.findings) : undefined;
  const visibleProducts = showCatalog ? products : (assessment?.candidates ?? []);
  return (
    <>
      <p className="page-description">
        Start with the component and its evidence. Then check which replacement options make sense.
      </p>
      <div className="catalog-banner">
        <PackageCheck size={30} strokeWidth={1.4} />
        <div>
          <h2>Replacement evidence & compatibility.</h2>
          <p>
            Exact part numbers are stored offline. This preview checks the interface and known
            service limits; OEM compatibility still needs verification.
          </p>
        </div>
        <span className="tiny-tag">Catalog {CATALOG_VERSION}</span>
      </div>
      {scan && (
        <section className="panel replacement-assessment">
          <label className="field-label" htmlFor="replacement-component">
            Which component are you considering?
          </label>
          <select
            id="replacement-component"
            value={componentId}
            onChange={(e) => {
              setComponentId(e.target.value);
              setShowCatalog(false);
            }}
          >
            {scan.components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.kind}
              </option>
            ))}
          </select>
          {assessment && (
            <div className="assessment-body">
              <div className="assessment-icon">
                {assessment.evidence.length ? (
                  <TriangleAlert size={23} />
                ) : (
                  <ShieldCheck size={23} />
                )}
              </div>
              <div>
                <div className="eyebrow">
                  {assessment.route === 'service'
                    ? 'MODEL-SPECIFIC SERVICE'
                    : assessment.route === 'plan'
                      ? 'REPLACEMENT PLANNING'
                      : assessment.route === 'investigate'
                        ? 'FURTHER DIAGNOSIS'
                        : 'REVIEW THE NEED'}
                </div>
                <h2>{assessment.title}</h2>
                <p>{assessment.explanation}</p>
                {assessment.evidence.length > 0 && (
                  <details>
                    <summary>
                      Evidence from this scan <Plus size={15} />
                    </summary>
                    <ul>
                      {assessment.evidence.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <ol>
                  {assessment.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      )}
      <div className="section-heading">
        <h2>{showCatalog ? 'Reference catalog' : 'Candidates for this component'}</h2>
        {scan && (
          <button className="text-button" onClick={() => setShowCatalog(!showCatalog)}>
            {showCatalog ? 'Show component candidates' : 'Browse reference catalog'}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      {!visibleProducts.length && (
        <div className="panel no-candidates">
          <CircleHelp size={25} />
          <div>
            <h3>No verified replacement is available in this catalog</h3>
            <p>
              {assessment?.route === 'service'
                ? 'Generic retail parts are excluded for this component. Check the exact OEM service assembly.'
                : 'The known component details do not match a supported catalog entry. More model-specific information is needed.'}
            </p>
          </div>
        </div>
      )}
      <div className="product-grid">
        {visibleProducts.map((product) => (
          <article className="product-card" key={product.id}>
            <div className="product-art" aria-hidden="true">
              <div className={`drive-drawing ${product.protocol === 'NVMe' ? 'nvme' : 'sata'}`}>
                <span>SAMSUNG</span>
                <strong>{product.name.replace('Samsung ', '')}</strong>
                <small>{product.capacity}</small>
              </div>
            </div>
            <div className="product-body">
              <span className="eyebrow">
                {product.protocol} · {product.formFactor}
              </span>
              <h2>
                {product.name} <span>{product.capacity}</span>
              </h2>
              <span className="part-number">{product.partNumber}</span>
              <p>{product.description}</p>
              <div className="fit-label">
                <CircleHelp size={15} />
                {showCatalog
                  ? 'Reference product · fit not verified'
                  : 'Interface candidate · fit not verified'}
              </div>
              <details>
                <summary>
                  What needs to match <Plus size={15} />
                </summary>
                <ul>
                  {product.constraints.map((constraint) => (
                    <li key={constraint}>{constraint}</li>
                  ))}
                </ul>
                <p className="subtle">
                  Product specifications checked {product.verifiedAt}. Retail availability is not
                  checked.
                </p>
                <label className="source-label">
                  Manufacturer reference
                  <input
                    readOnly
                    value={product.source}
                    aria-label={`${product.name} manufacturer reference`}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
              </details>
            </div>
          </article>
        ))}
      </div>
      <div className="message">
        <CircleHelp size={18} />
        Battery, RAM, CPU, and GPU replacement catalogs are not included yet. A product appearing
        here is not a recommendation to purchase it.
      </div>
    </>
  );
}
