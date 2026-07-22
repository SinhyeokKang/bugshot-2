import { useMemo } from "react";
import { GripVertical, Monitor, Moon, Paperclip, RotateCcw, SlidersHorizontal, Sparkles, StickyNote, Sun, WandSparkles } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { CollapsingTabsList, TabLabel } from "@/components/ui/collapsing-tabs";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import {
  DEFAULT_ISSUE_SECTIONS,
  sectionHelpKey,
  sectionLabelKey,
  useSettingsUiStore,
  type IssueSection,
  type LocaleMode,
  type ThemeMode,
} from "@/store/settings-ui-store";
import { useSettingsStore } from "@/store/settings-store";
import { PageScroll, PageShell, Section } from "@/sidepanel/components/Section";
import { isReproSectionEnabled } from "@/sidepanel/lib/reproSectionEnabled";
import { RecordingSettingsCard } from "@/sidepanel/components/RecordingSettingsCard";
import { SettingsFooter } from "./settings/SettingsFooter";
import { LlmConnectForm } from "./settings/LlmConnectForm";

const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

export function SettingsTab({ sub, onSubChange }: { sub: string; onSubChange: (v: string) => void }) {
  const t = useT();

  return (
    <Tabs
      value={sub}
      onValueChange={onSubChange}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-4">
        <CollapsingTabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="issue" className="min-w-0 gap-1.5" data-testid="settings-sub-issue">
            <StickyNote className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.issue")}</TabLabel>
          </TabsTrigger>
          <TabsTrigger value="ai" className="min-w-0 gap-1.5">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.ai")}</TabLabel>
          </TabsTrigger>
          <TabsTrigger value="general" className="min-w-0 gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <TabLabel>{t("settings.tab.general")}</TabLabel>
          </TabsTrigger>
        </CollapsingTabsList>
      </div>

      <TabsContent
        value="issue"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <IssueSettingsContent />
      </TabsContent>

      <TabsContent
        value="ai"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <LlmConnectForm />
      </TabsContent>

      <TabsContent
        value="general"
        className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <GeneralSettingsContent />
      </TabsContent>
    </Tabs>
  );
}

function IssueSettingsContent() {
  const t = useT();
  const issueSections = useSettingsUiStore((s) => s.issueSections);
  const setIssueEnabled = useSettingsUiStore((s) => s.setIssueEnabled);
  const reorderIssueSections = useSettingsUiStore((s) => s.reorderIssueSections);
  const resetIssueSectionOrder = useSettingsUiStore((s) => s.resetIssueSectionOrder);
  const attachmentsEnabled = useSettingsUiStore((s) => s.attachmentsEnabled);
  const setAttachmentsEnabled = useSettingsUiStore((s) => s.setAttachmentsEnabled);
  const autoReproPrefill = useSettingsUiStore((s) => s.autoReproPrefill);
  const setAutoReproPrefill = useSettingsUiStore((s) => s.setAutoReproPrefill);
  const titlePrefix = useSettingsStore((s) => s.titlePrefix);
  const setTitlePrefix = useSettingsStore((s) => s.setTitlePrefix);

  const sectionIds = issueSections.map((s) => s.id);
  const sectionLabel = (section: IssueSection) =>
    section.id === "media"
      ? t("settings.section.media")
      : section.labelOverride?.trim() || t(sectionLabelKey(section.id));

  const sensors = useSensors(
    // 활성화 거리를 두지 않으면 핸들의 클릭·포커스가 드래그로 먹힌다.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // dnd-kit 기본 안내는 영어 고정 — 로케일을 따르게 주입한다.
  const announcements: Announcements = useMemo(() => {
    const labelOf = (id: string | number) => {
      const found = issueSections.find((s) => s.id === id);
      return found ? sectionLabel(found) : String(id);
    };
    const positionOf = (id: string | number) =>
      issueSections.findIndex((s) => s.id === id) + 1;
    return {
      onDragStart: ({ active }) =>
        t("settings.reorder.announce.start", { label: labelOf(active.id) }),
      onDragOver: ({ active, over }) =>
        over
          ? t("settings.reorder.announce.move", {
              label: labelOf(active.id),
              position: positionOf(over.id),
            })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t("settings.reorder.announce.end", {
              label: labelOf(active.id),
              position: positionOf(over.id),
            })
          : undefined,
      onDragCancel: ({ active }) =>
        t("settings.reorder.announce.cancel", { label: labelOf(active.id) }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueSections, t]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderIssueSections(
      sectionIds.indexOf(active.id as IssueSection["id"]),
      sectionIds.indexOf(over.id as IssueSection["id"]),
    );
  };

  // 복원 버튼은 순서만 되돌리므로 판정도 순서만 본다(enabled는 사용자 것).
  const isDefaultOrder =
    issueSections.length === DEFAULT_ISSUE_SECTIONS.length &&
    issueSections.every((s, i) => s.id === DEFAULT_ISSUE_SECTIONS[i].id);

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.titleSettings")}>
          <div className="space-y-2">
            <Input
              id="title-prefix"
              placeholder={t("settings.titlePrefix.placeholder")}
              value={titlePrefix}
              onChange={(e) => setTitlePrefix(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[0.8rem] text-muted-foreground">
              {t("settings.titlePrefix.help")}
            </p>
          </div>
        </Section>

        <Section title={t("settings.recording")}>
          <RecordingSettingsCard />
        </Section>

        <Section
          title={t("settings.bodyComposition")}
          action={
            <Button
              size="icon"
              variant="outline"
              onClick={resetIssueSectionOrder}
              disabled={isDefaultOrder}
              title={t("settings.reorder.reset")}
              aria-label={t("settings.reorder.reset")}
              className="h-8 w-8 shrink-0"
              data-testid="reset-body-composition"
            >
              <RotateCcw />
            </Button>
          }
        >
          <Card>
            <CardContent className="flex flex-col px-3 py-0">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleDragEnd}
                accessibility={{
                  announcements,
                  screenReaderInstructions: {
                    draggable: t("settings.reorder.instructions"),
                  },
                }}
              >
                <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
                  {/* DndContext가 children 뒤에 접근성용 형제 div를 붙여 last:가 안 걸린다 — 한 겹 감싼다. */}
                  <div className="flex flex-col">
                    {issueSections.map((section) => (
                      <IssueSectionRow
                        key={section.id}
                        section={section}
                        label={sectionLabel(section)}
                        onToggle={(enabled) => setIssueEnabled(section.id, enabled)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        </Section>

        <Section title={t("settings.otherSection")}>
          <Card>
            <CardContent className="flex flex-col gap-3 px-3 py-3">
              <AutoReproPrefillToggleRow
                enabled={autoReproPrefill}
                onToggle={setAutoReproPrefill}
                disabled={!isReproSectionEnabled(issueSections)}
              />
              <Separator className="-mx-3 w-auto" />
              <AttachmentToggleRow
                enabled={attachmentsEnabled}
                onToggle={setAttachmentsEnabled}
              />
            </CardContent>
          </Card>
        </Section>
      </PageScroll>
      <SettingsFooter />
    </PageShell>
  );
}

function GeneralSettingsContent() {
  const t = useT();
  const theme = useSettingsUiStore((s) => s.theme);
  const setTheme = useSettingsUiStore((s) => s.setTheme);
  const locale = useSettingsUiStore((s) => s.locale);
  const setLocale = useSettingsUiStore((s) => s.setLocale);

  const themeOptions = [
    { value: "light" as ThemeMode, label: t("settings.theme.light"), icon: <Sun className="h-4 w-4" /> },
    { value: "dark" as ThemeMode, label: t("settings.theme.dark"), icon: <Moon className="h-4 w-4" /> },
    { value: "system" as ThemeMode, label: t("settings.theme.system"), icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <PageShell>
      <PageScroll>
        <Section title={t("settings.language")}>
          <Select value={locale} onValueChange={(v) => setLocale(v as LocaleMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title={t("settings.theme")}>
          <Select value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <span className="inline-flex items-center gap-1.5">
                    {o.icon}
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      </PageScroll>
      <SettingsFooter />
    </PageShell>
  );
}

function AttachmentToggleRow({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">
        <Paperclip className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor="setting-attachments-enabled" className="cursor-pointer text-sm font-medium">
          {t("settings.attachments.label")}
        </label>
        <p className="text-sm text-muted-foreground">{t("settings.attachments.help")}</p>
      </div>
      <Switch
        id="setting-attachments-enabled"
        checked={enabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}

function AutoReproPrefillToggleRow({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-50")}>
      <div className="shrink-0">
        <WandSparkles className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label
          htmlFor="setting-auto-repro-prefill"
          className={cn("text-sm font-medium", !disabled && "cursor-pointer")}
        >
          {t("settings.autoReproPrefill.label")}
        </label>
        <p className="text-sm text-muted-foreground">
          {t("settings.autoReproPrefill.help")}
        </p>
      </div>
      <Switch
        id="setting-auto-repro-prefill"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}

function IssueSectionRow({
  section,
  label,
  onToggle,
}: {
  section: IssueSection;
  label: string;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: section.id,
      // dnd-kit 기본 roleDescription은 영어 고정("sortable") — 로케일을 따르게 덮는다.
      attributes: { roleDescription: t("settings.reorder.roleDescription") },
    });
  const id = `issue-section-${section.id}`;
  const isMedia = section.id === "media";
  const help =
    section.id === "media"
      ? t("settings.section.media.help")
      : t(sectionHelpKey(section.id));

  return (
    <div
      ref={setNodeRef}
      // CSS.Transform은 scaleX/scaleY까지 문자열에 싣는다 — 높이가 다른 행끼리 자리를 바꿀 때
      // dnd-kit의 FLIP 보정 scaleY가 카드를 눌러 찌그러뜨리므로 translate만 적용한다.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // 구분선은 형제 Separator가 아니라 행 자신의 border — dnd transform과 함께 움직여야 잔상이 없다.
      className={cn(
        "-mx-3 flex items-center gap-3 border-t border-border px-3 py-3 first:border-t-0",
        isDragging && "relative z-10 rounded-md bg-muted shadow-md",
      )}
      data-testid={`issue-section-row-${section.id}`}
    >
      <Button
        size="icon"
        variant="ghost"
        // --ring이 --border와 같은 값이라 기본 링은 안 보인다(DESIGN §9) — 키보드 재정렬의
        // 유일한 진입점이라 이 버튼만 대비색 링을 쓴다.
        className="h-4 w-4 shrink-0 cursor-grab touch-none text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-primary active:cursor-grabbing"
        aria-label={t("settings.reorder.handle", { label })}
        data-testid={`issue-section-handle-${section.id}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {isMedia ? (
          <span className="text-sm font-medium">{label}</span>
        ) : (
          <label htmlFor={id} className="cursor-pointer text-sm font-medium">
            {label}
          </label>
        )}
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      {isMedia ? null : ( // 미디어는 켜고 끄는 대상이 아니다 — 본문 emit은 데이터 기반이라 스위치가 없다.
        <Switch
          id={id}
          checked={section.enabled}
          onCheckedChange={(v) => onToggle(v === true)}
        />
      )}
    </div>
  );
}
