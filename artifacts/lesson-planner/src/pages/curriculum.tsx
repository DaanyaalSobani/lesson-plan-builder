import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Loader2,
  AlertCircle,
  Search,
  Database,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Bucket = {
  subject: string;
  grade: string;
  count: number;
  source_versions: string[];
  last_ingested: string | null;
};

type Totals = {
  total_standards: number;
  total_subjects: number;
  total_grades: number;
  total_strands: number;
  last_ingested: string | null;
  is_empty: boolean;
  status: "green" | "amber" | "red";
  missing_combinations: { subject: string; grade: string }[];
};

type Summary = { buckets: Bucket[]; totals: Totals };

type Standard = {
  standard_code: string;
  strand: string | null;
  description: string;
  source_version: string | null;
  ingested_at: string | null;
};

type StandardsResponse = {
  subject: string;
  grade: string;
  standards: Standard[];
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function bucketKey(subject: string, grade: string) {
  return `${subject}::${grade}`;
}

function HealthBadge({ totals }: { totals: Totals }) {
  if (totals.status === "red") {
    return (
      <Badge variant="destructive" className="gap-1" data-testid="badge-health" data-status="red">
        <AlertTriangle className="w-3.5 h-3.5" />
        Empty — no curriculum loaded
      </Badge>
    );
  }
  if (totals.status === "amber") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        data-testid="badge-health"
        data-status="amber"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        Partial coverage ({totals.missing_combinations.length} gap
        {totals.missing_combinations.length === 1 ? "" : "s"})
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      data-testid="badge-health"
      data-status="green"
    >
      <CheckCircle2 className="w-3.5 h-3.5" />
      Healthy
    </Badge>
  );
}

function BucketDetail({ subject, grade, search }: { subject: string; grade: string; search: string }) {
  const standardsQuery = useQuery({
    queryKey: ["curriculum-standards", subject, grade],
    queryFn: async (): Promise<StandardsResponse> => {
      const res = await fetch(
        `/lesson-api/curriculum/standards?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`,
      );
      if (!res.ok) throw new Error("Failed to load standards");
      return res.json();
    },
  });

  if (standardsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading standards…
      </div>
    );
  }

  if (standardsQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Couldn't load standards for this bucket.</AlertDescription>
      </Alert>
    );
  }

  const all = standardsQuery.data?.standards ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? all.filter((s) =>
        [s.standard_code, s.strand ?? "", s.description, s.source_version ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : all;

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        {needle ? `No standards in this bucket match "${search}".` : "No standards in this bucket."}
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-[420px] rounded-md border border-border/50">
      <Table data-testid={`table-standards-${subject}-${grade}`}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">Code</TableHead>
            <TableHead className="w-[180px]">Strand</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-[120px]">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((s) => (
            <TableRow key={s.standard_code} data-testid={`row-standard-${s.standard_code}`}>
              <TableCell className="font-mono text-xs align-top">{s.standard_code}</TableCell>
              <TableCell className="text-xs text-muted-foreground align-top">
                {s.strand || "—"}
              </TableCell>
              <TableCell className="text-sm align-top">{s.description}</TableCell>
              <TableCell className="text-xs text-muted-foreground align-top">
                {s.source_version || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

export default function CurriculumPage() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summaryQuery = useQuery({
    queryKey: ["curriculum-summary"],
    queryFn: async (): Promise<Summary> => {
      const res = await fetch("/lesson-api/curriculum/summary");
      if (!res.ok) throw new Error("Failed to load curriculum summary");
      return res.json();
    },
  });

  const buckets = summaryQuery.data?.buckets ?? [];
  const totals = summaryQuery.data?.totals;

  // When a search is active we don't pre-filter buckets, because the search
  // also targets standard codes/strands/descriptions which only the per-bucket
  // detail loader knows about. Instead we keep all buckets visible and let
  // each detail panel filter its own rows; expanding-on-search makes matches
  // visible without the user having to click each bucket.
  const filteredBuckets = buckets;

  const searchActive = search.trim().length > 0;

  function isOpen(key: string) {
    return searchActive || expanded.has(key);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="min-h-[100dvh] w-full bg-background flex justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl flex flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col gap-4 pt-4 pb-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back-home">
                <ArrowLeft className="w-4 h-4" />
                Back to generator
              </Button>
            </Link>
            {totals && <HealthBadge totals={totals} />}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-serif text-foreground tracking-tight">
                Curriculum Library
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Every standard the lesson planner can cite. Each generated plan is grounded in
                the rows shown below.
              </p>
            </div>
          </div>
        </header>

        {/* Pipeline health strip */}
        {summaryQuery.isLoading && (
          <Card>
            <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading library…
            </CardContent>
          </Card>
        )}

        {summaryQuery.isError && (
          <Alert variant="destructive" data-testid="alert-summary-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load the curriculum library</AlertTitle>
            <AlertDescription>
              The backend may be down. Check the Python Backend workflow and try again.
            </AlertDescription>
          </Alert>
        )}

        {totals && (
          <Card data-testid="card-pipeline-health">
            <CardContent className="p-5 md:p-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-base font-serif">Pipeline health</h2>
                <span className="text-xs text-muted-foreground">
                  Last ingested: {formatTimestamp(totals.last_ingested)}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <Stat label="Standards" value={totals.total_standards} testid="stat-standards" />
                <Stat label="Subjects" value={totals.total_subjects} testid="stat-subjects" />
                <Stat label="Grades" value={totals.total_grades} testid="stat-grades" />
                <Stat label="Strands" value={totals.total_strands} testid="stat-strands" />
              </div>
              {totals.is_empty && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>The curriculum table is empty</AlertTitle>
                  <AlertDescription>
                    Generated plans will have no standards to cite. Run the ingest pipeline to load data.
                  </AlertDescription>
                </Alert>
              )}
              {totals.status === "amber" && (
                <Alert
                  className="mt-4 border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  data-testid="alert-coverage-gaps"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Coverage gaps detected</AlertTitle>
                  <AlertDescription>
                    Some subject &times; grade combinations have zero standards loaded:{" "}
                    {totals.missing_combinations
                      .map((m) => `${m.subject} · Grade ${m.grade}`)
                      .join(", ")}
                    .
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Search */}
        {totals && !totals.is_empty && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by subject, grade, code, strand, or description…"
              className="pl-9"
              data-testid="input-curriculum-search"
            />
          </div>
        )}

        {/* Buckets list */}
        {totals && !totals.is_empty && (
          <div className="space-y-3" data-testid="list-buckets">
            {filteredBuckets.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-buckets">
                No subject/grade buckets loaded.
              </p>
            )}
            {filteredBuckets.map((b) => {
              const key = bucketKey(b.subject, b.grade);
              const open = isOpen(key);
              return (
                <Card key={key} className="overflow-hidden" data-testid={`card-bucket-${b.subject}-${b.grade}`}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full text-left p-4 md:p-5 hover-elevate flex items-center gap-3"
                    data-testid={`button-bucket-${b.subject}-${b.grade}`}
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex items-center gap-2 flex-wrap flex-1">
                      <Badge variant="secondary" className="text-xs">{b.subject}</Badge>
                      <Badge variant="outline" className="text-xs">Grade {b.grade}</Badge>
                      <span className="text-sm font-medium text-foreground">
                        {b.count} {b.count === 1 ? "standard" : "standards"}
                      </span>
                      {b.source_versions.length > 0 && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground cursor-help">
                                · {b.source_versions.join(", ")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Source curriculum version(s)</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
                      Ingested {formatTimestamp(b.last_ingested)}
                    </span>
                  </button>
                  {open && (
                    <div className="px-4 md:px-5 pb-4 md:pb-5 border-t border-border/50 pt-4">
                      <BucketDetail subject={b.subject} grade={b.grade} search={search} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <footer className="text-center text-xs text-muted-foreground py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 hover:text-foreground"
            data-testid="link-footer-home"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Back to lesson plan generator
          </Link>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div className="rounded-lg border border-border/50 p-3" data-testid={testid}>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-foreground mt-1">{value}</div>
    </div>
  );
}
