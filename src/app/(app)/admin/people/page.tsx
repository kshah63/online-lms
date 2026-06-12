import { CheckCircle2, CircleAlert, GraduationCap, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPersonDialog } from "@/components/admin/add-person-dialog";
import { AccountRequests } from "@/components/admin/account-requests";
import { requireRole } from "@/lib/data/auth";
import {
  getConsents,
  getPendingAccountRequests,
  listParents,
  listStudents,
  listTeachers,
} from "@/lib/data/people";
import type { ConsentType, Profile } from "@/lib/types";

const REQUIRED_STUDENT_CONSENTS: ConsentType[] = ["recording", "ai_analysis"];

export default async function AdminPeoplePage() {
  await requireRole("admin");
  const [teachers, students, parents, accountRequests] = await Promise.all([
    listTeachers(),
    listStudents(),
    listParents(),
    getPendingAccountRequests(),
  ]);

  const studentRows = await Promise.all(
    students.map(async (s) => {
      const consents = await getConsents(s.id);
      const granted = new Set(consents.map((c) => c.type));
      const missing = REQUIRED_STUDENT_CONSENTS.filter((t) => !granted.has(t));
      return { student: s, missing };
    }),
  );

  return (
    <div>
      <PageHeader
        title="People"
        description="Teachers, students and parents — with consent status."
        actions={<AddPersonDialog parents={parents.map((p) => ({ id: p.id, display_name: p.display_name }))} />}
      />

      <AccountRequests requests={accountRequests} />

      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
          <TabsTrigger value="teachers">Teachers ({teachers.length})</TabsTrigger>
          <TabsTrigger value="parents">Parents ({parents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Students
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {studentRows.map(({ student, missing }) => (
                <div key={student.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={student.display_name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{student.display_name}</div>
                    <div className="text-xs text-muted-foreground">{student.timezone.replace(/_/g, " ")}</div>
                  </div>
                  {missing.length === 0 ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Consent complete
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1">
                      <CircleAlert className="h-3 w-3" /> Missing: {missing.join(", ")}
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teachers">
          <PeopleList people={teachers} icon={<GraduationCap className="h-4 w-4" />} title="Teachers" />
        </TabsContent>

        <TabsContent value="parents">
          <PeopleList people={parents} icon={<Users className="h-4 w-4" />} title="Parents" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PeopleList({ people, icon, title }: { people: Profile[]; icon: React.ReactNode; title: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-3">
            <Avatar name={p.display_name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.display_name}</div>
              <div className="text-xs text-muted-foreground">{p.email}</div>
            </div>
            <Badge variant="secondary">{p.timezone.replace(/_/g, " ")}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
