import { GraduationCap, Link2, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddPersonDialog } from "@/components/admin/add-person-dialog";
import { AccountRequests } from "@/components/admin/account-requests";
import { RecordingToggle } from "@/components/admin/recording-toggle";
import { requireRole } from "@/lib/data/auth";
import {
  getPendingAccountRequests,
  listParents,
  listPencilLinkedProfileIds,
  listRecordingOptOuts,
  listStudents,
  listTeachers,
} from "@/lib/data/people";
import type { Profile } from "@/lib/types";

export default async function AdminPeoplePage() {
  await requireRole("admin");
  const [teachers, students, parents, accountRequests, optOuts, pencilLinked] = await Promise.all([
    listTeachers(),
    listStudents(),
    listParents(),
    getPendingAccountRequests(),
    listRecordingOptOuts(),
    listPencilLinkedProfileIds(),
  ]);
  const optedOut = new Set(optOuts.map((o) => o.student_id));

  return (
    <div>
      <PageHeader
        title="People"
        description="Teachers, students and parents — recording policy and Pencil Spaces status."
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
              <CardDescription>
                Lessons are recorded (audio + board) by default. Opting a student out pushes &ldquo;do not
                record&rdquo; to every Pencil Space they have and is confirmed by read-back; no transcript,
                summary or coaching exists for their lessons.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {students.map((student) => (
                <div key={student.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={student.display_name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{student.display_name}</span>
                      {pencilLinked.has(student.id) && <PencilLinkedBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground">{student.timezone.replace(/_/g, " ")}</div>
                  </div>
                  <RecordingToggle
                    studentId={student.id}
                    studentName={student.display_name}
                    optedOut={optedOut.has(student.id)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teachers">
          <PeopleList
            people={teachers}
            icon={<GraduationCap className="h-4 w-4" />}
            title="Teachers"
            description="Every teacher's lessons are recorded and AI-evaluated for coaching — a condition of teaching on MathVision."
            pencilLinked={pencilLinked}
          />
        </TabsContent>

        <TabsContent value="parents">
          <PeopleList
            people={parents}
            icon={<Users className="h-4 w-4" />}
            title="Parents"
            description="Parents follow lessons from a status card; they have no seat in the Pencil Space."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** A `pencil_users` row exists — the profile has a Pencil API user (provisioned lazily on first join). */
function PencilLinkedBadge() {
  return (
    <Badge variant="default" className="gap-1" title="Has a Pencil Spaces user (created on first join)">
      <Link2 className="h-3 w-3" /> Pencil linked
    </Badge>
  );
}

function PeopleList({
  people,
  icon,
  title,
  description,
  pencilLinked,
}: {
  people: Profile[];
  icon: React.ReactNode;
  title: string;
  description?: string;
  pencilLinked?: Set<string>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="divide-y">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-3">
            <Avatar name={p.display_name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.display_name}</span>
                {pencilLinked?.has(p.id) && <PencilLinkedBadge />}
              </div>
              <div className="text-xs text-muted-foreground">{p.email}</div>
            </div>
            <Badge variant="secondary">{p.timezone.replace(/_/g, " ")}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
