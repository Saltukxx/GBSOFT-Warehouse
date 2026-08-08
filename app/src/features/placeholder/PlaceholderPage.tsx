import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Note, Panel } from "../../components/ui/primitives";

/**
 * Demo kapsamı dışındaki navigasyon öğeleri disabled değildir; düzgün
 * bir "örnek görünüm" ekranı açar (§5.1).
 */

type Props = {
  eyebrow: string;
  title: string;
  purpose: string;
  /** Bu ekranın gerçek üründe cevapladığı sorular. */
  questions: string[];
  actions: string[];
  relatedTo: { label: string; to: string };
};

export function PlaceholderPage({
  eyebrow,
  title,
  purpose,
  questions,
  actions,
  relatedTo,
}: Props) {
  return (
    <div className="page">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={purpose}
        primaryAction={
          <Link className="btn btn--primary" to={relatedTo.to}>
            {relatedTo.label}
          </Link>
        }
      />
      <div className="page__body stack stack-4">
        <Note tone="neutral">
          Bu ekran demo kapsamında örnek görünümdür. Ürün tasarımı tamamlanmış,
          uygulaması bu sürüme alınmamıştır.
        </Note>

        <div className="grid-2">
          <Panel title="Ana sorular">
            <ul className="text-sm" style={{ margin: 0, paddingLeft: 18 }}>
              {questions.map((q) => (
                <li key={q} style={{ padding: "2px 0" }}>
                  {q}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Eylemler">
            <ul className="text-sm" style={{ margin: 0, paddingLeft: 18 }}>
              {actions.map((a) => (
                <li key={a} style={{ padding: "2px 0" }}>
                  {a}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
