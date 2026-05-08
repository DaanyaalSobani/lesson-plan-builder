import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Sparkles,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Copy,
  Check,
  History,
  FileText,
  Download,
  Pencil,
  Trash2,
  X,
  Database,
  ChevronDown,
} from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const formSchema = z.object({
  subject: z.string().min(1, "Please select a subject."),
  grade: z.string().min(1, "Please select a grade."),
  teacher_request: z.string().min(10, "Please provide a bit more detail for the lesson request."),
});

type FormValues = z.infer<typeof formSchema>;

type LessonPlanSummary = {
  id: number;
  subject: string;
  grade: string;
  teacher_request: string;
  title?: string | null;
  created_at: string;
};

type Citation = {
  code: string;
  description: string;
  found_in_curriculum: boolean;
};

type ConsideredStandard = {
  code: string;
  strand?: string | null;
  description: string;
  cited: boolean;
};

type LessonPlanDetail = LessonPlanSummary & {
  lesson_plan: string;
  citations?: Citation[];
  considered_standards?: ConsideredStandard[];
};

type GenerateResponse = {
  id: number;
  lesson_plan: string;
  citations: Citation[];
  considered_standards: ConsideredStandard[];
};

type CurriculumBucket = {
  subject: string;
  grade: string;
  count: number;
  source_versions: string[];
  last_ingested: string | null;
};

type CurriculumSummary = {
  buckets: CurriculumBucket[];
  totals: {
    total_standards: number;
    total_subjects: number;
    total_grades: number;
    total_strands: number;
    last_ingested: string | null;
    is_empty: boolean;
  };
};

type DisplayedPlan = {
  id: number;
  subject: string;
  grade: string;
  teacher_request: string;
  lesson_plan: string;
  citations: Citation[];
  considered_standards: ConsideredStandard[];
  title?: string | null;
  created_at?: string;
};

/**
 * Some lesson-plan responses arrive with markdown tables collapsed onto a
 * single line — e.g. "| Code | How |...|------|----| | A | B | | C | D |".
 * react-markdown (even with GFM) will only render those as a table when
 * each row sits on its own line, so we re-insert the missing newlines
 * before a header separator and between subsequent row cells.
 *
 * We deliberately only touch lines that look like a multi-row collapsed
 * table (have a `|---|` separator AND at least one extra `| ... |` row on
 * the same line); ordinary inline `|` characters in prose are left alone.
 */
function normalizeMarkdownTables(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      // Quick reject: must contain the GFM separator pattern AND have more
      // than one trailing `| ... |` group on the same line.
      if (!/\|\s*-{3,}\s*\|/.test(line)) return line;
      // Collapse runs of whitespace that sit between row boundaries (`| |`)
      // into a real newline. The pattern `| <empty-or-spaces> |` between two
      // closing/opening pipes is the marker between two rows that the
      // model glued together.
      let out = line.replace(/\|\s+\|/g, (match) => {
        // Preserve a single `| |` (which is a legitimately empty cell)
        // when it appears inside a row of more empty cells; only break
        // when surrounded by non-pipe content on both sides.
        return match;
      });
      // Insert a newline before the header separator row so the header is
      // on its own line: "| H1 | H2 | |---|---| | r1 | r2 |"
      // -> "| H1 | H2 |\n|---|---|\n| r1 | r2 |"
      out = out.replace(/\|\s*(\|\s*-{3,}[\s\S]*)$/, "|\n$1");
      // Then split the separator + body wherever a `| ... |` row begins
      // immediately after a closing pipe.
      out = out.replace(/\|\s+\|\s*(?=\S)/g, "|\n| ");
      return out;
    })
    .join("\n");
}

function formatTimestamp(iso: string): string {
  // Backend stores UTC strings like "2026-05-08 14:23:01"; treat as UTC.
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

function CitationsPanel({
  citations,
  onJumpToCode,
}: {
  citations: Citation[];
  onJumpToCode: (code: string) => void;
}) {
  const verifiedCount = citations.filter((c) => c.found_in_curriculum).length;
  const unverifiedCount = citations.length - verifiedCount;

  return (
    <Card className="bg-card/50 border-border/50" data-testid="panel-citations">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h3 className="text-base font-serif text-foreground">Standards cited in this plan</h3>
          {citations.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {verifiedCount} verified
              {unverifiedCount > 0 ? ` · ${unverifiedCount} unverified` : ""}
            </span>
          )}
        </div>

        {citations.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-citations-empty">
            This plan does not cite any specific curriculum standards.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              Click any code to jump to where it appears in the plan above.
            </p>
            <TooltipProvider delayDuration={150}>
              <ul className="flex flex-wrap gap-2" data-testid="list-citations">
                {citations.map((c) => {
                  const baseClasses =
                    "font-mono text-xs cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-opacity";
                  const chip = c.found_in_curriculum ? (
                    <Tooltip key={c.code}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onJumpToCode(c.code)}
                          data-testid={`citation-chip-${c.code}`}
                          data-verified="true"
                          aria-label={`Jump to ${c.code} in the plan`}
                          className={cn(badgeVariants({ variant: "secondary" }), baseClasses)}
                        >
                          {c.code}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs leading-snug">{c.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip key={c.code}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onJumpToCode(c.code)}
                          data-testid={`citation-chip-${c.code}`}
                          data-verified="false"
                          aria-label={`Jump to ${c.code} in the plan (unverified)`}
                          className={cn(
                            badgeVariants({ variant: "outline" }),
                            baseClasses,
                            "border-amber-500/60 text-amber-700 dark:text-amber-400 gap-1",
                          )}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {c.code}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs leading-snug">
                          This standard code was not found in the curriculum database — please verify manually.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                  return <li key={c.code}>{chip}</li>;
                })}
              </ul>
            </TooltipProvider>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConsideredStandardsPanel({
  standards,
  onJumpToCode,
}: {
  standards: ConsideredStandard[];
  onJumpToCode: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const citedCount = standards.filter((s) => s.cited).length;
  const total = standards.length;

  return (
    <Card className="bg-card/50 border-border/50" data-testid="panel-considered">
      <CardContent className="p-5 md:p-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="button-toggle-considered"
          className="w-full flex items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-serif text-foreground">Standards considered</h3>
            {total > 0 ? (
              <span className="text-xs text-muted-foreground">
                {total} retrieved · {citedCount} cited · {total - citedCount} not cited
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">none retrieved</span>
            )}
          </div>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform shrink-0",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="mt-4">
            {total === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-considered-empty">
                No curriculum standards were retrieved for this subject and grade. The plan was
                generated without curriculum grounding.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  These are all the standards that were sent to the AI. Cited ones appear in the
                  plan above; the rest were available but not used.
                </p>
                <ul className="space-y-2" data-testid="list-considered">
                  {standards.map((s) => (
                    <li
                      key={s.code}
                      data-testid={`considered-row-${s.code}`}
                      data-cited={s.cited ? "true" : "false"}
                      className={cn(
                        "rounded-md border p-3 flex gap-3 items-start",
                        s.cited
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/60 bg-background/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => s.cited && onJumpToCode(s.code)}
                        disabled={!s.cited}
                        aria-label={
                          s.cited
                            ? `Jump to ${s.code} in the plan`
                            : `${s.code} (not cited in this plan)`
                        }
                        className={cn(
                          badgeVariants({ variant: s.cited ? "secondary" : "outline" }),
                          "font-mono text-xs shrink-0",
                          s.cited
                            ? "cursor-pointer hover:opacity-80"
                            : "opacity-70 cursor-default",
                        )}
                      >
                        {s.code}
                      </button>
                      <div className="min-w-0 flex-1">
                        {s.strand && (
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                            {s.strand}
                          </p>
                        )}
                        <p className="text-sm text-foreground leading-snug">{s.description}</p>
                      </div>
                      {s.cited ? (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          Cited
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] shrink-0 text-muted-foreground">
                          Not cited
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [displayedPlan, setDisplayedPlan] = useState<DisplayedPlan | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: "",
      grade: "",
      teacher_request: "",
    },
  });

  const summaryQuery = useQuery({
    queryKey: ["curriculum-summary"],
    queryFn: async (): Promise<CurriculumSummary> => {
      const res = await fetch("/lesson-api/curriculum/summary");
      if (!res.ok) throw new Error("Failed to load curriculum summary");
      return res.json();
    },
  });

  const subjects = useMemo(() => {
    const set = new Set<string>();
    summaryQuery.data?.buckets.forEach((b) => set.add(b.subject));
    return Array.from(set).sort();
  }, [summaryQuery.data]);

  const selectedSubject = form.watch("subject");
  const selectedGrade = form.watch("grade");

  const gradesForSubject = useMemo(() => {
    if (!selectedSubject) return [] as string[];
    const set = new Set<string>();
    summaryQuery.data?.buckets
      .filter((b) => b.subject === selectedSubject)
      .forEach((b) => set.add(b.grade));
    return Array.from(set).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [summaryQuery.data, selectedSubject]);

  const standardsCount = useMemo(() => {
    if (!selectedSubject || !selectedGrade) return null;
    const bucket = summaryQuery.data?.buckets.find(
      (b) => b.subject === selectedSubject && b.grade === selectedGrade,
    );
    return bucket ? bucket.count : 0;
  }, [summaryQuery.data, selectedSubject, selectedGrade]);

  const generateMutation = useMutation({
    mutationFn: async (data: FormValues): Promise<GenerateResponse> => {
      const res = await fetch("/lesson-api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.text()) || "Failed to generate lesson plan");
      return res.json();
    },
    onSuccess: (resp, vars) => {
      setDisplayedPlan({
        id: resp.id,
        subject: vars.subject,
        grade: vars.grade,
        teacher_request: vars.teacher_request,
        lesson_plan: resp.lesson_plan,
        citations: resp.citations ?? [],
        considered_standards: resp.considered_standards ?? [],
      });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const historyQuery = useQuery({
    queryKey: ["history"],
    queryFn: async (): Promise<LessonPlanSummary[]> => {
      const res = await fetch("/lesson-api/history");
      if (!res.ok) throw new Error("Failed to load history");
      const json = await res.json();
      return json.plans as LessonPlanSummary[];
    },
    enabled: historyOpen,
  });

  const loadPlanMutation = useMutation({
    mutationFn: async (id: number): Promise<LessonPlanDetail> => {
      const res = await fetch(`/lesson-api/history/${id}`);
      if (!res.ok) throw new Error("Failed to load lesson plan");
      return res.json();
    },
    onSuccess: (plan) => {
      setDisplayedPlan({
        ...plan,
        citations: plan.citations ?? [],
        considered_standards: plan.considered_standards ?? [],
      });
      setHistoryOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async (vars: { id: number; title: string | null }): Promise<LessonPlanDetail> => {
      const res = await fetch(`/lesson-api/history/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: vars.title }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Failed to rename plan");
      return res.json();
    },
    onSuccess: (plan) => {
      setRenamingId(null);
      setRenameDraft("");
      setHistoryActionError(null);
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setDisplayedPlan((curr) =>
        curr && curr.id === plan.id ? { ...curr, title: plan.title } : curr,
      );
    },
    onError: (err) => {
      setHistoryActionError(err instanceof Error ? err.message : "Could not rename plan.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number): Promise<number> => {
      const res = await fetch(`/lesson-api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.text()) || "Failed to delete plan");
      return id;
    },
    onSuccess: (id) => {
      setPendingDeleteId(null);
      setHistoryActionError(null);
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setDisplayedPlan((curr) => (curr && curr.id === id ? null : curr));
    },
    onError: (err) => {
      setHistoryActionError(err instanceof Error ? err.message : "Could not delete plan.");
    },
  });

  function startRename(plan: LessonPlanSummary) {
    setHistoryActionError(null);
    setRenamingId(plan.id);
    setRenameDraft(plan.title ?? "");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }

  function submitRename(id: number) {
    const trimmed = renameDraft.trim();
    renameMutation.mutate({ id, title: trimmed.length === 0 ? null : trimmed });
  }

  const pendingDeletePlan =
    pendingDeleteId != null
      ? historyQuery.data?.find((p) => p.id === pendingDeleteId) ?? null
      : null;

  function onSubmit(data: FormValues) {
    generateMutation.mutate(data);
  }

  const copyToClipboard = () => {
    if (displayedPlan) {
      navigator.clipboard.writeText(displayedPlan.lesson_plan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const jumpToCode = (code: string) => {
    const root = outputRef.current;
    if (!root) return;
    const needle = `[${code}]`;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      if (node.nodeValue && node.nodeValue.includes(needle)) {
        const parent = node.parentElement;
        if (parent) {
          parent.scrollIntoView({ behavior: "smooth", block: "center" });
          const prev = parent.style.transition;
          const prevBg = parent.style.backgroundColor;
          parent.style.transition = "background-color 200ms ease-in";
          parent.style.backgroundColor = "rgba(250, 204, 21, 0.35)";
          window.setTimeout(() => {
            parent.style.transition = "background-color 800ms ease-out";
            parent.style.backgroundColor = prevBg;
            window.setTimeout(() => {
              parent.style.transition = prev;
            }, 850);
          }, 600);
        }
        return;
      }
      node = walker.nextNode();
    }
  };

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "plan";

  const downloadPdf = async () => {
    if (!displayedPlan || !outputRef.current) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const rendered = outputRef.current.innerHTML;
      const safe = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const container = document.createElement("div");
      container.style.cssText =
        "padding:32px 36px;font-family:Georgia,'Times New Roman',serif;color:#1f2937;line-height:1.55;font-size:12pt;background:#ffffff;width:760px;";
      container.innerHTML = `
        <div style="border-bottom:1px solid #d4d4d8;padding-bottom:16px;margin-bottom:20px;">
          <h1 style="font-size:22pt;margin:0 0 12px 0;color:#0f172a;">Lesson Plan</h1>
          <div style="font-size:11pt;color:#374151;margin-bottom:4px;"><strong>Subject:</strong> ${safe(displayedPlan.subject)}</div>
          <div style="font-size:11pt;color:#374151;margin-bottom:4px;"><strong>Grade:</strong> ${safe(displayedPlan.grade)}</div>
          ${displayedPlan.created_at ? `<div style="font-size:11pt;color:#374151;margin-bottom:8px;"><strong>Saved:</strong> ${safe(formatTimestamp(displayedPlan.created_at))}</div>` : ""}
          <div style="font-size:11pt;color:#374151;margin-top:8px;"><strong>Request:</strong><div style="margin-top:4px;white-space:pre-wrap;">${safe(displayedPlan.teacher_request)}</div></div>
        </div>
        <div class="lp-pdf-body">${rendered}</div>
        <style>
          .lp-pdf-body h1{font-size:18pt;margin:18px 0 8px;color:#0f172a;}
          .lp-pdf-body h2{font-size:15pt;margin:16px 0 6px;color:#0f172a;}
          .lp-pdf-body h3{font-size:13pt;margin:14px 0 4px;color:#1f2937;}
          .lp-pdf-body p{margin:0 0 8px;}
          .lp-pdf-body ul,.lp-pdf-body ol{margin:0 0 10px 22px;padding:0;}
          .lp-pdf-body li{margin:0 0 4px;}
          .lp-pdf-body strong{color:#0f172a;}
          .lp-pdf-body code{font-family:'Courier New',monospace;background:#f1f5f9;padding:1px 4px;border-radius:3px;}
          .lp-pdf-body blockquote{border-left:3px solid #cbd5e1;padding-left:10px;color:#475569;margin:0 0 10px;}
        </style>
      `;
      const filename = `lesson-plan-${slugify(displayedPlan.subject)}-grade-${slugify(displayedPlan.grade)}-${displayedPlan.id}.pdf`;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(container)
        .save();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Could not generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex justify-center p-4 md:p-8">
      <div className="w-full max-w-3xl flex flex-col gap-8">

        {/* Header */}
        <header className="flex flex-col items-center text-center space-y-4 pt-8 pb-4 relative">
          <div className="absolute right-0 top-8 flex items-center gap-2">
            <Link href="/curriculum">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-open-curriculum"
                className="gap-2"
              >
                <Database className="w-4 h-4" />
                Curriculum
              </Button>
            </Link>
            <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-open-history"
                  className="gap-2"
                >
                  <History className="w-4 h-4" />
                  History
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
                <SheetHeader>
                  <SheetTitle>Saved lesson plans</SheetTitle>
                  <SheetDescription>
                    Your previously generated plans, newest first. Click one to view it.
                  </SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1 -mx-6 px-6 mt-4">
                  {historyQuery.isLoading && (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Loading…
                    </div>
                  )}
                  {historyQuery.isError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>Couldn't load history.</AlertDescription>
                    </Alert>
                  )}
                  {historyQuery.data && historyQuery.data.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-history-empty">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      No lesson plans saved yet. Generate one to get started.
                    </div>
                  )}
                  {historyActionError && (
                    <Alert variant="destructive" className="mb-3" data-testid="alert-history-action-error">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{historyActionError}</AlertDescription>
                    </Alert>
                  )}
                  {historyQuery.data && historyQuery.data.length > 0 && (
                    <ul className="space-y-2 pb-4" data-testid="list-history">
                      {historyQuery.data.map((p) => {
                        const isRenaming = renamingId === p.id;
                        const isSavingRename = isRenaming && renameMutation.isPending;
                        return (
                          <li
                            key={p.id}
                            className="p-3 rounded-lg border border-border/60 bg-card/50 hover:border-border transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="secondary" className="text-xs">{p.subject}</Badge>
                              <Badge variant="outline" className="text-xs">Grade {p.grade}</Badge>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {formatTimestamp(p.created_at)}
                              </span>
                            </div>
                            {isRenaming ? (
                              <div className="space-y-2">
                                <Input
                                  autoFocus
                                  value={renameDraft}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      submitRename(p.id);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelRename();
                                    }
                                  }}
                                  maxLength={200}
                                  placeholder="Give this plan a title…"
                                  disabled={isSavingRename}
                                  data-testid={`input-rename-${p.id}`}
                                  className="h-8 text-sm"
                                />
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => submitRename(p.id)}
                                    disabled={isSavingRename}
                                    data-testid={`button-rename-save-${p.id}`}
                                  >
                                    {isSavingRename ? (
                                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5 mr-1.5" />
                                    )}
                                    Save
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={cancelRename}
                                    disabled={isSavingRename}
                                    data-testid={`button-rename-cancel-${p.id}`}
                                  >
                                    <X className="w-3.5 h-3.5 mr-1.5" />
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => loadPlanMutation.mutate(p.id)}
                                  disabled={loadPlanMutation.isPending}
                                  data-testid={`button-history-item-${p.id}`}
                                  className="w-full text-left rounded-md hover-elevate disabled:opacity-50"
                                >
                                  {p.title ? (
                                    <p
                                      className="text-sm font-medium text-foreground line-clamp-2"
                                      data-testid={`text-history-title-${p.id}`}
                                    >
                                      {p.title}
                                    </p>
                                  ) : null}
                                  <p
                                    className={
                                      p.title
                                        ? "text-xs text-muted-foreground line-clamp-2 mt-1"
                                        : "text-sm text-foreground line-clamp-2"
                                    }
                                  >
                                    {p.teacher_request}
                                  </p>
                                </button>
                                <div className="flex items-center gap-1 mt-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() => startRename(p)}
                                    data-testid={`button-history-rename-${p.id}`}
                                  >
                                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                                    Rename
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                    onClick={() => {
                                      setHistoryActionError(null);
                                      setPendingDeleteId(p.id);
                                    }}
                                    data-testid={`button-history-delete-${p.id}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    Delete
                                  </Button>
                                </div>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </ScrollArea>
              </SheetContent>
            </Sheet>
            <AlertDialog
              open={pendingDeleteId !== null}
              onOpenChange={(open) => {
                if (!open && !deleteMutation.isPending) {
                  setPendingDeleteId(null);
                }
              }}
            >
              <AlertDialogContent data-testid="dialog-delete-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this lesson plan?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingDeletePlan?.title
                      ? `"${pendingDeletePlan.title}" will be permanently removed.`
                      : "This plan will be permanently removed and can't be recovered."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={deleteMutation.isPending}
                    data-testid="button-delete-cancel"
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleteMutation.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (pendingDeleteId != null) deleteMutation.mutate(pendingDeleteId);
                    }}
                    data-testid="button-delete-confirm"
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Deleting…
                      </>
                    ) : (
                      "Delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-serif text-foreground tracking-tight">Lesson Plan Generator</h1>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              Describe what you want to teach. We'll structure it into a standards-aligned plan.
            </p>
          </div>
        </header>

        {/* Input Form */}
        <Card className="border-border/50 shadow-sm bg-card/50 backdrop-blur">
          <CardContent className="p-6 md:p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                            const stillValid = summaryQuery.data?.buckets.some(
                              (b) => b.subject === v && b.grade === form.getValues("grade"),
                            );
                            if (!stillValid) form.setValue("grade", "");
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-subject" className="bg-background">
                              <SelectValue placeholder="Select subject..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {subjects.length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                {summaryQuery.isLoading ? "Loading…" : "No subjects available"}
                              </div>
                            )}
                            {subjects.map((s) => (
                              <SelectItem
                                key={s}
                                value={s}
                                data-testid={`option-subject-${s.toLowerCase()}`}
                              >
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="grade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Grade Level</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                          }}
                          value={field.value}
                          disabled={!selectedSubject || gradesForSubject.length === 0}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-grade" className="bg-background">
                              <SelectValue
                                placeholder={
                                  selectedSubject ? "Select grade..." : "Pick a subject first…"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {gradesForSubject.map((g) => (
                              <SelectItem
                                key={g}
                                value={g}
                                data-testid={`option-grade-${g}`}
                              >
                                Grade {g}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {selectedSubject && selectedGrade && standardsCount !== null && (
                  <div
                    className={cn(
                      "text-xs rounded-md px-3 py-2 border",
                      standardsCount === 0
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-border/50 bg-muted/40 text-muted-foreground",
                    )}
                    data-testid="text-standards-preview"
                  >
                    {standardsCount === 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        No standards loaded for {selectedSubject} · Grade {selectedGrade}. Claude
                        will generate without curriculum grounding.
                      </span>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">{standardsCount}</span>{" "}
                        {standardsCount === 1 ? "standard" : "standards"} will be sent to Claude
                        for {selectedSubject} · Grade {selectedGrade}.{" "}
                        <Link
                          href="/curriculum"
                          className="underline hover:text-foreground"
                          data-testid="link-view-curriculum"
                        >
                          View library
                        </Link>
                      </>
                    )}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="teacher_request"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What do you want to teach?</FormLabel>
                      <FormControl>
                        <Textarea
                          data-testid="textarea-request"
                          placeholder="e.g. I want a lesson on multiplying fractions with visual models, focusing on word problems."
                          className="min-h-[120px] resize-y bg-background"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  data-testid="button-generate"
                  className="w-full h-12 text-base font-medium shadow-sm hover-elevate transition-all"
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Generating Plan...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate Lesson Plan
                    </>
                  )}
                </Button>

                {generateMutation.isError && (
                  <Alert variant="destructive" className="mt-4" data-testid="alert-error">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Generation Failed</AlertTitle>
                    <AlertDescription>
                      {generateMutation.error instanceof Error ? generateMutation.error.message : "An unexpected error occurred."}
                    </AlertDescription>
                  </Alert>
                )}
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Output Section */}
        {displayedPlan && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <div className="flex items-center justify-between px-2 gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-serif text-foreground" data-testid="text-displayed-plan-heading">
                  {displayedPlan.title
                    ? displayedPlan.title
                    : generateMutation.isSuccess && generateMutation.data?.id === displayedPlan.id
                    ? "Generated Plan"
                    : "Saved Plan"}
                </h2>
                <Badge variant="secondary" className="text-xs">{displayedPlan.subject}</Badge>
                <Badge variant="outline" className="text-xs">Grade {displayedPlan.grade}</Badge>
                {displayedPlan.created_at && (
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(displayedPlan.created_at)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToClipboard}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="button-copy"
                >
                  {copied ? <Check className="w-4 h-4 mr-2 text-green-600" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadPdf}
                  disabled={downloading}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="button-download-pdf"
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  {downloading ? "Preparing…" : "Download PDF"}
                </Button>
              </div>
            </div>
            {downloadError && (
              <Alert variant="destructive" data-testid="alert-download-error">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Couldn't download PDF</AlertTitle>
                <AlertDescription>{downloadError}</AlertDescription>
              </Alert>
            )}
            <Separator />
            <Card className="bg-card shadow-sm border-border/50">
              <CardContent ref={outputRef} className="p-6 md:p-10 prose prose-sage max-w-none prose-headings:font-serif prose-p:leading-relaxed" data-testid="output-area">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownTables(displayedPlan.lesson_plan)}
                </ReactMarkdown>
              </CardContent>
            </Card>

            <CitationsPanel citations={displayedPlan.citations} onJumpToCode={jumpToCode} />

            <ConsideredStandardsPanel
              standards={displayedPlan.considered_standards}
              onJumpToCode={jumpToCode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
