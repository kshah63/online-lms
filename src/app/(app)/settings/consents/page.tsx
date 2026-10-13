import { ExternalLink, ShieldCheck } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { CONSENT_LABEL, getLessonConsents } from "@/lib/data/consents";
import { getChildren } from "@/lib/data/family";
import { displayName, firstName } from "@/lib/types";

const APP_CONSENTS_URL = "https://mathvisionapp.com/family";

/**
 * The four lesson consents per child, read from lesson_consents under RLS.
 * Read-only here for everyone: a parent grants and revokes them in the
 * MathVision app (set_lesson_consent); a student sees what their parent
 * decided.
 */
export default async function ConsentsPage() {
  const profile = await requireRole("student", "parent");
  const tz = viewerTimeZone(profile);
  const children = await getChildren(profile);
  const consents = await getLessonConsents(children.map((c) => c.id));
  const parent = profile.role === "parent";

  return (
    <div>
      <PageHeader
        title="Lesson consents"
        description={
          parent
            ? "What you have agreed to for each child's online lessons. They are managed in the MathVision app."
            : "What your parent has agreed to for your online lessons. Your parent manages these in the MathVision app."
        }
        actions={
          parent ? (
            <Button asChild variant="outline" size="sm">
              <a href={APP_CONSENTS_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Manage in the app
              </a>
            </Button>
          ) : undefined
        }
      />

      {children.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No child on this account yet" description="Children are added to a family in the MathVision app." />
      ) : (
        <div className="space-y-6">
          {children.map((child) => (
            <Card key={child.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{parent ? displayName(child) : `${firstName(child)}'s lessons`}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {(consents.get(child.id) ?? []).map((c) => {
                    const meta = CONSENT_LABEL[c.kind];
                    return (
                      <li key={c.kind} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{meta.title}</div>
                          <p className="text-sm text-muted-foreground">{meta.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                          <Badge variant={c.granted ? "success" : "outline"}>{c.granted ? "Granted" : "Not granted"}</Badge>
                          {c.granted && c.granted_at && (
                            <span className="text-xs text-muted-foreground">since {DateTime.fromISO(c.granted_at, { zone: "utc" }).setZone(tz).toFormat("d LLL yyyy")}</span>
                          )}
                          {!c.granted && c.revoked_at && (
                            <span className="text-xs text-muted-foreground">withdrawn {DateTime.fromISO(c.revoked_at, { zone: "utc" }).setZone(tz).toFormat("d LLL yyyy")}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {parent ? "Managed in the MathVision app, on the child's screen under Consents." : "Managed by your parent in the MathVision app."}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
