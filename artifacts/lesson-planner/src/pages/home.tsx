import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import ReactMarkdown from "react-markdown";
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
  created_at: string;
};

type Citation = {
  code: string;
  description: string;
  found_in_curriculum: boolean;
};

type LessonPlanDetail = LessonPlanSummary & {
  lesson_plan: string;
  citations?: Citation[];
};

type GenerateResponse = {
  id: number;
  lesson_plan: string;
  citations: Citation[];
};

type DisplayedPlan = {
  id: number;
  subject: string;
  grade: string;
  teacher_request: string;
  lesson_plan: string;
  citations: Citation[];
  created_at?: string;
};

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

export default function Home() {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [displayedPlan, setDisplayedPlan] = useState<DisplayedPlan | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      setDisplayedPlan({ ...plan, citations: plan.citations ?? [] });
      setHistoryOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

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
          <div className="absolute right-0 top-8">
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
                  {historyQuery.data && historyQuery.data.length > 0 && (
                    <ul className="space-y-2 pb-4" data-testid="list-history">
                      {historyQuery.data.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => loadPlanMutation.mutate(p.id)}
                            disabled={loadPlanMutation.isPending}
                            data-testid={`button-history-item-${p.id}`}
                            className="w-full text-left p-3 rounded-lg border border-border/60 bg-card/50 hover:bg-accent hover:border-border transition-colors disabled:opacity-50"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary" className="text-xs">{p.subject}</Badge>
                              <Badge variant="outline" className="text-xs">Grade {p.grade}</Badge>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {formatTimestamp(p.created_at)}
                              </span>
                            </div>
                            <p className="text-sm text-foreground line-clamp-2">
                              {p.teacher_request}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </SheetContent>
            </Sheet>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-subject" className="bg-background">
                              <SelectValue placeholder="Select subject..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ELA" data-testid="option-ela">ELA</SelectItem>
                            <SelectItem value="Math" data-testid="option-math">Math</SelectItem>
                            <SelectItem value="Science" data-testid="option-science">Science</SelectItem>
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-grade" className="bg-background">
                              <SelectValue placeholder="Select grade..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="3" data-testid="option-grade-3">Grade 3</SelectItem>
                            <SelectItem value="4" data-testid="option-grade-4">Grade 4</SelectItem>
                            <SelectItem value="5" data-testid="option-grade-5">Grade 5</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                <h2 className="text-xl font-serif text-foreground">
                  {generateMutation.isSuccess && generateMutation.data?.id === displayedPlan.id
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
                <ReactMarkdown>
                  {displayedPlan.lesson_plan}
                </ReactMarkdown>
              </CardContent>
            </Card>

            <CitationsPanel citations={displayedPlan.citations} onJumpToCode={jumpToCode} />
          </div>
        )}
      </div>
    </div>
  );
}
