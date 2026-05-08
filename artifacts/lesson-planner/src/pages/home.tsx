import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import ReactMarkdown from "react-markdown";
import { BookOpen, Sparkles, Loader2, AlertCircle, Copy, Check } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  subject: z.string().min(1, "Please select a subject."),
  grade: z.string().min(1, "Please select a grade."),
  teacher_request: z.string().min(10, "Please provide a bit more detail for the lesson request."),
});

type FormValues = z.infer<typeof formSchema>;

export default function Home() {
  const [copied, setCopied] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: "",
      grade: "",
      teacher_request: "",
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch("/lesson-api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text() || "Failed to generate lesson plan");
      const json = await res.json();
      return json.lesson_plan as string;
    },
  });

  function onSubmit(data: FormValues) {
    generateMutation.mutate(data);
  }

  const copyToClipboard = () => {
    if (generateMutation.data) {
      navigator.clipboard.writeText(generateMutation.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex justify-center p-4 md:p-8">
      <div className="w-full max-w-3xl flex flex-col gap-8">
        
        {/* Header */}
        <header className="flex flex-col items-center text-center space-y-4 pt-8 pb-4">
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
        {generateMutation.data && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-xl font-serif text-foreground">Generated Plan</h2>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={copyToClipboard}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-copy"
              >
                {copied ? <Check className="w-4 h-4 mr-2 text-green-600" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
            </div>
            <Separator />
            <Card className="bg-card shadow-sm border-border/50">
              <CardContent className="p-6 md:p-10 prose prose-sage max-w-none prose-headings:font-serif prose-p:leading-relaxed" data-testid="output-area">
                <ReactMarkdown>
                  {generateMutation.data}
                </ReactMarkdown>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
