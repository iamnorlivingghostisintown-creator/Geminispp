import React, { useState, useRef, useMemo, useEffect } from 'react';
import { extractFromText, extractFromJSON, scoreEntry, getSentiment, detectTopics, detectPeopleInText, Entry } from './utils';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { FixedSizeList } from 'react-window';
import { get, set, keys, del } from 'idb-keyval';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, BarChart, Bar, Legend, AreaChart, Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, Trash2, Download, Brain, MessageSquare, Filter, 
  BarChart3, LayoutGrid, Clock, Users, Tag, Sparkles,
  ChevronRight, ChevronDown, AlertCircle, CheckCircle2, GitCompare, EyeOff,
  History, FileText, X, Code, Settings, Activity, Hash
} from 'lucide-react';
import JSZip from 'jszip';

const safeJsonParse = (text: string | undefined): any => {
  if (!text) return {};
  try {
    // Remove potential markdown code blocks
    const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON Parse error:", e, "Raw text:", text);
    // Try to find the first '{' or '[' and last '}' or ']'
    try {
      const startObj = text.indexOf('{');
      const startArr = text.indexOf('[');
      const start = (startObj !== -1 && (startArr === -1 || startObj < startArr)) ? startObj : startArr;
      
      const endObj = text.lastIndexOf('}');
      const endArr = text.lastIndexOf(']');
      const end = (endObj !== -1 && (endArr === -1 || endObj > endArr)) ? endObj : endArr;

      if (start !== -1 && end !== -1) {
        return JSON.parse(text.substring(start, end + 1));
      }
    } catch (e2) {
      console.error("Secondary JSON Parse error:", e2);
    }
    return {};
  }
};

const highlightKeywords = (text: string, keywords: string[]) => {
  if (!keywords || keywords.length === 0) return text;
  const safeKeywords = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${safeKeywords.join('|')})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, i) => 
    keywords.some(k => k.toLowerCase() === part.toLowerCase()) 
      ? <mark key={i} className="bg-[var(--amber)] text-black px-0.5 rounded-sm not-italic font-bold">{part}</mark> 
      : part
  );
};

const renderHighlightedText = (text: string, highlight: string | undefined, colorClass: string) => {
  if (!highlight || !text.toLowerCase().includes(highlight.toLowerCase())) return text;
  
  const safeHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${safeHighlight})`, 'gi');
  const parts = text.split(pattern);
  
  return parts.map((part, i) => 
    part.toLowerCase() === highlight.toLowerCase() 
      ? <mark key={i} className={`${colorClass} text-black px-1 rounded-sm not-italic font-bold shadow-sm`}>{part}</mark> 
      : part
  );
};

// Entry type is imported from utils.ts

type AIBatch = {
  id: number;
  chunk: Entry[];
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('instant');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [aiStories, setAiStories] = useState<any[]>([]);
  const [aiRejectedStories, setAiRejectedStories] = useState<any[]>([]);
  const [aiBatches, setAiBatches] = useState<AIBatch[]>([]);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [fileProcessingProgress, setFileProcessingProgress] = useState(0);
  const isAiLoadingRef = useRef(false);
  const [aiProgress, setAiProgress] = useState('');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const deferredSearch = React.useDeferredValue(archiveSearch);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(true);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  
  const [isGuardianEnabled, setIsGuardianEnabled] = useState(false);
  const [guardianFindings, setGuardianFindings] = useState<any[]>([]);
  const [guardianSettings, setGuardianSettings] = useState({
    sensitivity: 7,
    focusAreas: 'Life changes, emotional nuances, subtle corrections',
    thinkingLevel: ThinkingLevel.HIGH
  });
  
  const [minScore, setMinScore] = useState(0);
  const [removeAI, setRemoveAI] = useState(true);
  
  const [comparisonEntries, setComparisonEntries] = useState<Entry[]>([]);
  const [comparisonResults, setComparisonResults] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonSuccess, setComparisonSuccess] = useState(false);
  const isComparingRef = useRef(false);
  const [comparisonBatches, setComparisonBatches] = useState<any[]>([]);
  const [comparisonFindings, setComparisonFindings] = useState<{
    entry: Entry, 
    reason: string, 
    newFileQuote?: string, 
    connectionReason?: string, 
    importanceReason?: string,
    sourceHighlight?: string,
    newFileHighlight?: string,
    newFileFullMessage?: string
  }[]>([]);
  const [comparisonThoughts, setComparisonThoughts] = useState<string[]>([]);
  
  const [isArchiveMinimized, setIsArchiveMinimized] = useState(false);
  const [removeShort, setRemoveShort] = useState(true);
  const [minChars, setMinChars] = useState(50);
  
  const [excludedWords, setExcludedWords] = useState<string[]>(['es', 'lo', 'jax', 'ashe']);
  const [exclInput, setExclInput] = useState('');
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  const [customPromptText, setCustomPromptText] = useState('');
  const [customPromptFileData, setCustomPromptFileData] = useState<string | null>(null);
  const [customPromptFileName, setCustomPromptFileName] = useState<string | null>(null);
  const [customPromptMimeType, setCustomPromptMimeType] = useState<string | null>(null);
  const [isCustomPromptEnabled, setIsCustomPromptEnabled] = useState(false);
  const promptFileInputRef = useRef<HTMLInputElement>(null);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const [claudeSynthesis, setClaudeSynthesis] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false);
  const [isAiSuiteOpen, setIsAiSuiteOpen] = useState(false);
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const aiSuiteMenuRef = useRef<HTMLDivElement>(null);

  const [usage, setUsage] = useState<Record<string, { requests: number, tokens: number }>>({});

  const [isAiOptionsCollapsed, setIsAiOptionsCollapsed] = useState(false);
  const [manualQuota, setManualQuota] = useState<Record<string, number>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  useEffect(() => {
    get('gemini_usage').then(val => {
      if (val) setUsage(val);
    });
    get('manual_quota').then(val => {
      if (val) setManualQuota(val);
    });
  }, []);

  const trackUsage = async (model: string, response: any) => {
    const tokens = response.usageMetadata?.totalTokenCount || 0;
    
    setManualQuota(prev => {
      if (prev[model] !== undefined) {
        const next = { ...prev, [model]: Math.max(0, prev[model] - 1) };
        set('manual_quota', next);
        return next;
      }
      return prev;
    });

    setUsage(prev => {
      const next = { ...prev };
      if (!next[model]) next[model] = { requests: 0, tokens: 0 };
      next[model].requests += 1;
      next[model].tokens += tokens;
      set('gemini_usage', next);
      return next;
    });
  };

  const [modelConfig, setModelConfig] = useState({
    scan: 'gemini-3-flash-preview',
    compare: 'gemini-3.1-pro-preview',
    accuracy: 'gemini-3.1-pro-preview',
    chat: 'gemini-3.1-pro-preview'
  });

  const availableModels = [
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: 'Deep reasoning, best for complex analysis.', date: '2025-02' },
    { id: 'gemini-3.1-flash-preview', name: 'Gemini 3.1 Flash', desc: 'Fast and intelligent, balanced performance.', date: '2025-02' },
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', desc: 'Lightweight, extremely fast, lower cost.', date: '2025-02' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Ultra-fast, high limits, great for scanning.', date: '2024-12' },
  ];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (scanMenuRef.current && !scanMenuRef.current.contains(event.target as Node)) {
        setIsScanMenuOpen(false);
      }
      if (aiSuiteMenuRef.current && !aiSuiteMenuRef.current.contains(event.target as Node)) {
        setIsAiSuiteOpen(false);
      }
      if (openDropdown && !(event.target as HTMLElement).closest('.model-dropdown-container')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  const [expandedStories, setExpandedStories] = useState<Set<number>>(new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [expandedRejected, setExpandedRejected] = useState<Set<string>>(new Set());

  const toggleStoryExpand = (id: number) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEntryExpand = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // If using VariableSizeList, we'd need to notify the list to recalculate heights
  };

  const toggleRejectedExpand = (id: string) => {
    setExpandedRejected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const restoreGuardianFinding = (finding: any, index: number) => {
    setAiStories(prev => [...prev, { 
      text: finding.text, 
      one_line: finding.text.slice(0, 50) + '...', 
      theme: 'Guardian Restored', 
      emotion: 'Unknown', 
      timeframe: 'Unknown', 
      importance: finding.suggestedImportance || 7 
    }].sort((a: any, b: any) => b.importance - a.importance));
    
    setAiRejectedStories(prev => prev.filter(r => r.uId !== finding.uId));
    setGuardianFindings(prev => prev.map((f, i) => i === index ? { ...f, status: 'restored' } : f));
    showNotification("Restored by Guardian AI", "success");
  };

  const [fileHistory, setFileHistory] = useState<{name: string, timestamp: number, type: 'source' | 'compare' | 'accuracy', size: number}[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const [accDocFile, setAccDocFile] = useState<any | null>(null);
  const [accResults, setAccResults] = useState<string | null>(null);
  const [isAccChecking, setIsAccChecking] = useState(false);
  const [accuracyError, setAccuracyError] = useState<string | null>(null);
  const [accuracySuccess, setAccuracySuccess] = useState(false);
  const isAccCheckingRef = useRef(false);
  const [accBatches, setAccBatches] = useState<AIBatch[]>([]);
  const [accFindings, setAccFindings] = useState<any[]>([]);
  const [accThoughts, setAccThoughts] = useState<string[]>([]);
  const [comparisonLiveLog, setComparisonLiveLog] = useState<string[]>([]);
  const [accLiveLog, setAccLiveLog] = useState<string[]>([]);

  const [sourceFiles, setSourceFiles] = useState<{ path: string; content: string }[]>([]);
  const [isFetchingSource, setIsFetchingSource] = useState(false);
  const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null);

  const fetchSourceCode = async () => {
    setIsFetchingSource(true);
    try {
      const response = await fetch('/api/source-code');
      const data = await response.json();
      setSourceFiles(data);
      if (data.length > 0 && !selectedSourceFile) {
        setSelectedSourceFile(data[0].path);
      }
    } catch (error) {
      console.error("Error fetching source code:", error);
      showNotification("Failed to fetch source code", "error");
    } finally {
      setIsFetchingSource(false);
    }
  };

  const downloadAllCode = async () => {
    if (sourceFiles.length === 0) return;
    const zip = new JSZip();
    sourceFiles.forEach(file => {
      zip.file(file.path, file.content);
    });
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = "app-source-code.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAllForAI = () => {
    if (sourceFiles.length === 0) return;
    
    const header = `--- CRITICAL: REPLICATE THIS APP 100% IDENTICALLY ---
I am providing the COMPLETE source code for my React application. 
YOUR ABSOLUTE PRIORITY is to recreate this application EXACTLY as it is. 
- DO NOT "improve" the code.
- DO NOT change the UI or Tailwind classes.
- DO NOT refactor the state management.
- DO NOT add or remove features.
- DO NOT stitch things together differently.
- LITERALLY copy every character of the logic and styling.

This must be a 1:1 identical clone.
--------------------------------------\n\n`;

    const combined = sourceFiles.map(file => {
      return `--- FILE: ${file.path} ---\n${file.content}\n`;
    }).join('\n');

    const footer = `\n\n--- END OF SOURCE CODE ---
Please build the application based on these files. Ensure every single detail is preserved. No deviations allowed.`;

    navigator.clipboard.writeText(header + combined + footer);
    showNotification("100% Identical Prompt copied for Gemini!", "success");
  };

  const resetAiExtract = () => {
    setIsAiLoading(false);
    isAiLoadingRef.current = false;
    setAiStories([]);
    setAiRejectedStories([]);
    setAiBatches([]);
    setAiProgress('');
    showNotification("AI extraction stopped and reset.", "info");
  };

  const resetSummary = () => {
    setIsSummarizing(false);
    setAiSummary(null);
    showNotification("Summary generation stopped.", "info");
  };

  const resetComparison = () => {
    setIsComparing(false);
    isComparingRef.current = false;
    setComparisonResults(null);
    setComparisonFindings([]);
    setComparisonThoughts([]);
    setComparisonBatches([]);
    setComparisonLiveLog([]);
    showNotification("Comparison stopped and reset.", "info");
  };

  const resetAccuracy = () => {
    setIsAccChecking(false);
    isAccCheckingRef.current = false;
    setAccResults(null);
    setAccFindings([]);
    setAccThoughts([]);
    setAccBatches([]);
    setAccLiveLog([]);
    showNotification("Accuracy check stopped and reset.", "info");
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const refreshHistory = async () => {
    try {
      const meta = await get('file_history_metadata');
      if (meta && Array.isArray(meta)) {
        setFileHistory(meta.sort((a, b) => b.timestamp - a.timestamp));
        return;
      }
      
      // Fallback: Rebuild metadata from all possible history keys
      const allKeys = await keys();
      const items = await Promise.all(allKeys.map(async k => {
        if (typeof k !== 'string') return null;
        
        try {
          if (k.startsWith('file_hist_content_')) {
            // New format: file_hist_content_{type}_{timestamp}_{name}
            const parts = k.replace('file_hist_content_', '').split('_');
            if (parts.length < 3) return null;
            const type = parts[0] as 'source' | 'compare';
            const timestamp = parseInt(parts[1]);
            const name = parts.slice(2).join('_');
            return { key: k, name, timestamp, type, size: 0 };
          } else if (k.startsWith('file_hist_') && !k.startsWith('file_history_')) {
            // Old format: data is an object
            const data = await get(k);
            if (!data || typeof data !== 'object') return null;
            return {
              key: k,
              name: data.name || 'Unknown File',
              timestamp: data.timestamp || Date.now(),
              type: data.type || 'source',
              size: data.size || 0
            };
          }
        } catch (e) {
          return null;
        }
        return null;
      }));

      const validItems = items.filter((i): i is NonNullable<typeof i> => i !== null).sort((a, b) => b.timestamp - a.timestamp);
      setFileHistory(validItems);
      if (validItems.length > 0) {
        await set('file_history_metadata', validItems);
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const saveToHistory = async (file: File, type: 'source' | 'compare' | 'accuracy') => {
    if (file.size > 15 * 1024 * 1024) {
      console.warn("File too large for history storage (>15MB)");
      return;
    }
    const text = await file.text();
    const timestamp = Date.now();
    const id = `${type}_${timestamp}_${file.name}`;
    const contentKey = `file_hist_content_${id}`;
    
    // Store content separately
    await set(contentKey, text);
    
    // Update metadata
    const newMeta = {
      key: contentKey,
      name: file.name,
      timestamp,
      type,
      size: file.size
    };
    
    const currentMeta = await get('file_history_metadata') || [];
    const updatedMeta = [newMeta, ...currentMeta.filter((m: any) => m.name !== file.name || m.type !== type)].slice(0, 50); // Keep last 50
    await set('file_history_metadata', updatedMeta);
  };

  const loadFromHistory = async (key: string) => {
    setIsHistoryLoading(true);
    try {
      const data = await get(key);
      if (!data) {
        throw new Error("File content not found in history");
      }
      
      // Determine content and metadata
      let content: string;
      let fileName: string;
      let fileType: 'source' | 'compare' | 'accuracy';

      if (typeof data === 'object' && data.content) {
        // Old format
        content = data.content;
        fileName = data.name || "Restored File";
        fileType = data.type || 'source';
      } else {
        // New format (data is the string content)
        content = data as string;
        const meta = await get('file_history_metadata') || [];
        const itemMeta = meta.find((m: any) => m.key === key);
        fileName = itemMeta?.name || "Restored File";
        fileType = itemMeta?.type || 'source';
      }
      
      const pseudoFile = {
        name: fileName,
        text: async () => content
      };

      if (fileType === 'compare') {
        await handleComparisonFiles([pseudoFile as any]);
      } else if (fileType === 'accuracy') {
        await handleAccuracyFile(pseudoFile as any);
      } else {
        await handleFiles([pseudoFile as any]);
      }
      showNotification(`Loaded ${fileName} from history`, "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to load file from history", "error");
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const deleteFromHistory = async (key: string) => {
    await del(key);
    const currentMeta = await get('file_history_metadata') || [];
    const updatedMeta = currentMeta.filter((m: any) => m.key !== key);
    await set('file_history_metadata', updatedMeta);
    refreshHistory();
    showNotification("Removed from history", "info");
  };

  const clearAllHistory = async () => {
    try {
      const allKeys = await keys();
      const historyKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('file_hist_'));
      await Promise.all(historyKeys.map(k => del(k)));
      await del('file_history_metadata');
      refreshHistory();
      showNotification("All history cleared", "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to clear history", "error");
    }
  };

  const loadAllFromHistory = async (type: 'source' | 'compare') => {
    setIsHistoryLoading(true);
    try {
      const meta = await get('file_history_metadata') || [];
      const filteredMeta = meta.filter((m: any) => m.type === type);
      
      if (filteredMeta.length === 0) {
        // Fallback to scanning keys if metadata is empty (maybe old format or first run)
        const allKeys = await keys();
        const oldPrefix = `file_hist_${type}_`;
        const historyKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(oldPrefix));
        
        if (historyKeys.length === 0) {
          showNotification("No history files found to load", "info");
          return;
        }
        
        const allData = await Promise.all(historyKeys.map(k => get(k)));
        const validData = allData.filter(d => d && d.content);
        
        if (validData.length === 0) {
          showNotification("No history files found to load", "info");
          return;
        }

        const pseudoFiles = validData.map(d => ({
          name: d.name,
          text: async () => d.content
        }));

        if (type === 'source') await handleFiles(pseudoFiles as any);
        else await handleComparisonFiles(pseudoFiles as any);
        
        showNotification(`Loaded ${validData.length} files from history`, "success");
        return;
      }

      // Load using metadata (new format)
      const pseudoFiles = await Promise.all(filteredMeta.map(async (m: any) => {
        const data = await get(m.key);
        if (!data) return null;
        
        // Handle both formats just in case metadata points to an old object
        const text = (typeof data === 'object' && data.content) ? data.content : data;
        
        return {
          name: m.name,
          text: async () => text
        };
      }));

      const validPseudoFiles = pseudoFiles.filter((f): f is NonNullable<typeof f> => f !== null);

      if (validPseudoFiles.length === 0) {
        showNotification("No history files found to load", "info");
        return;
      }

      if (type === 'source') await handleFiles(validPseudoFiles as any);
      else await handleComparisonFiles(validPseudoFiles as any);
      
      showNotification(`Loaded ${validPseudoFiles.length} files from history`, "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to load all files from history", "error");
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const [aiTotalProcessed, setAiTotalProcessed] = useState(0);
  const [aiProcessedSoFar, setAiProcessedSoFar] = useState(0);
  const [notification, setNotification] = useState<{msg: string, type: 'info' | 'error' | 'success'} | null>(null);
  const [confirmState, setConfirmState] = useState<Record<string, boolean>>({});

  // Pre-compile exclusion regexes
  const exclusionRegexes = useMemo(() => {
    return excludedWords.map(w => {
      const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-zA-Z0-9_])' + safe + '(?![a-zA-Z0-9_])', 'i');
    });
  }, [excludedWords]);

  const toggleHide = (uId: string) => {
    setEntries(prev => prev.map(e => e.uId === uId ? { ...e, isHidden: !e.isHidden } : e));
  };

  const filteredData = useMemo(() => {
    const kept: Entry[] = [];
    const removed: Entry[] = [];

    for (let i = 0; i < entries.length; i++) {
      const e = { ...entries[i] };
      let isKept = true;

      if (e.isHidden) {
        isKept = false;
        e.removalReason = 'Manual';
      } else if (e.score < minScore) {
        isKept = false;
        e.removalReason = 'Low-Score';
      } else if (removeAI && e.isAssistant) {
        isKept = false;
        e.removalReason = 'AI-Reply';
      } else if (removeShort && e.charCount < minChars) {
        isKept = false;
        e.removalReason = 'Short';
      } else {
        const matches: string[] = [];
        for (let j = 0; j < exclusionRegexes.length; j++) {
          if (exclusionRegexes[j].test(e.text)) {
            isKept = false;
            e.removalReason = 'Keyword';
            matches.push(excludedWords[j]);
          }
        }
        if (matches.length > 0) e.matchedKeywords = matches;
      }

      if (isKept) kept.push(e);
      else removed.push(e);
    }

    return { kept, removed };
  }, [entries, minScore, removeAI, removeShort, minChars, exclusionRegexes, excludedWords]);

  const overallStats = useMemo(() => {
    const { kept } = filteredData;
    const total = entries.length;
    const avgScore = kept.length ? Math.round(kept.reduce((a, e) => a + e.score, 0) / kept.length) : 0;
    const words = Math.round(kept.reduce((a, e) => a + e.charCount, 0) / 5);
    const wordsStr = words > 999 ? (words / 1000).toFixed(1) + 'k' : words.toString();
    const peopleSet = new Set<string>();
    for (const e of kept) {
      for (const p of e.people) peopleSet.add(p);
    }
    
    return { kept: kept.length, total, avgScore, words: wordsStr, people: peopleSet.size };
  }, [entries.length, filteredData]);

  const filteredEntries = useMemo(() => {
    let base = [...filteredData.kept];
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase().trim();
      base = base.filter(e => e.text.toLowerCase().includes(q));
    }
    return base.sort((a, b) => b.score - a.score);
  }, [filteredData.kept, deferredSearch]);

  const removedEntries = useMemo(() => {
    let base = [...filteredData.removed].sort((a, b) => b.score - a.score);
    if (selectedKeyword) {
      return base.filter(e => e.matchedKeywords?.includes(selectedKeyword));
    }
    return base;
  }, [filteredData.removed, selectedKeyword]);

  const activeKeywords = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredData.removed.forEach(e => {
      if (e.removalReason === 'Keyword' && e.matchedKeywords) {
        e.matchedKeywords.forEach(k => {
          counts[k] = (counts[k] || 0) + 1;
        });
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredData.removed]);

  const generateSummary = async () => {
    if (entries.length === 0) return;
    setIsSummarizing(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const sample = filteredEntries.slice(0, 20).map(e => e.text).join('\n\n---\n\n');
      const prompt = `Summarize this personal archive. 
      Identify:
      1. Time period covered (if possible)
      2. Key life events or recurring themes
      3. Overall emotional tone
      4. A "TL;DR" of who this person is based on these snippets.
      
      Keep it under 250 words. Use bullet points.
      
      ${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

      Archive Snippets:
      ${sample}`;
      
      const response = await ai.models.generateContent({
        model: modelConfig.scan,
        contents: {
          parts: [
            ...(isCustomPromptEnabled && customPromptFileData ? [{
              inlineData: {
                data: customPromptFileData,
                mimeType: customPromptMimeType || 'text/plain'
              }
            }] : []),
            { text: prompt }
          ]
        },
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      
      trackUsage(modelConfig.scan, response);
      setAiSummary(response.text);
      // If there are grounding chunks, we could display them, but for summary it's less critical
    } catch (e) {
      console.error(e);
      showNotification("Failed to generate summary.", "error");
    } finally {
      setIsSummarizing(false);
    }
  };

  const SourceCodeView = () => {
    const currentFileContent = useMemo(() => {
      return sourceFiles.find(f => f.path === selectedSourceFile)?.content || "";
    }, [selectedSourceFile, sourceFiles]);

    useEffect(() => {
      if (sourceFiles.length === 0) {
        fetchSourceCode();
      }
    }, []);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[70vh]">
        <div className="lg:col-span-1 glass rounded-2xl p-4 overflow-y-auto custom-scrollbar flex flex-col">
          <div className="mb-4 p-4 bg-[var(--amber-dim)] border border-[var(--amber)]/30 rounded-2xl shadow-lg">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--amber)] mb-2">Replicate This App</h4>
            <p className="text-[9px] text-[var(--muted)] leading-relaxed mb-4">
              Click the button below to copy a specialized prompt containing the entire source code. Paste this into Gemini to recreate this exact application 100% identically.
            </p>
            <button 
              onClick={copyAllForAI}
              disabled={isFetchingSource || sourceFiles.length === 0}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-[var(--amber)] text-black hover:bg-[var(--amber-g)] transition-all disabled:opacity-50 shadow-xl active:scale-95 group"
            >
              <Sparkles className="w-5 h-5 group-hover:animate-spin" />
              <span className="text-[11px] font-bold uppercase tracking-[3px]">Copy 100% Identical Prompt</span>
            </button>
          </div>

          <div className="flex items-center justify-between mb-4 shrink-0 px-2">
            <h3 className="font-mono text-[10px] font-bold tracking-widest uppercase text-[var(--muted)]">Project Files</h3>
            <div className="flex items-center gap-2">
              <button 
                onClick={fetchSourceCode}
                disabled={isFetchingSource}
                className="p-2 rounded-lg bg-[var(--s2)] text-[var(--muted)] hover:text-[var(--cyan)] transition-all disabled:opacity-50"
                title="Refresh Files"
              >
                <History className={`w-4 h-4 ${isFetchingSource ? 'animate-spin' : ''}`} />
              </button>
              <button 
                onClick={downloadAllCode}
                disabled={isFetchingSource || sourceFiles.length === 0}
                className="p-2 rounded-lg bg-[var(--s2)] text-[var(--muted)] hover:text-[var(--amber)] transition-all disabled:opacity-50"
                title="Download All as ZIP"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="space-y-1 flex-1">
            {isFetchingSource && (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
            {sourceFiles.map(file => (
              <button
                key={file.path}
                onClick={() => setSelectedSourceFile(file.path)}
                className={`w-full text-left px-3 py-2 rounded-lg text-[10px] font-mono truncate transition-all ${selectedSourceFile === file.path ? 'bg-[var(--amber-dim)] text-[var(--amber)] border border-[var(--amber)]/30' : 'text-[var(--muted)] hover:bg-[var(--s2)] hover:text-[var(--text)]'}`}
              >
                {file.path}
              </button>
            ))}
          </div>
        </div>
        <div className="lg:col-span-3 glass rounded-2xl p-0 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--s1)] shrink-0">
            <span className="font-mono text-[10px] text-[var(--muted)] tracking-wider">{selectedSourceFile || "Select a file to view code"}</span>
            {selectedSourceFile && (
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(currentFileContent);
                  showNotification("Copied to clipboard", "success");
                }}
                className="text-[10px] font-mono uppercase tracking-widest text-[var(--cyan)] hover:underline"
              >
                Copy Code
              </button>
            )}
          </div>
          <div className="flex-1 p-6 overflow-auto custom-scrollbar bg-black/20">
            {selectedSourceFile ? (
              <pre className="font-mono text-[11px] leading-relaxed text-[var(--text)] whitespace-pre-wrap selection:bg-[var(--amber)] selection:text-black">
                {currentFileContent}
              </pre>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] opacity-50">
                <Code className="w-12 h-12 mb-4" />
                <p className="font-mono text-[10px] uppercase tracking-widest">Select a file from the sidebar</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const Dashboard = () => {
    const topicData = useMemo(() => {
      const counts: Record<string, number> = {};
      filteredEntries.forEach(e => {
        counts[e.topic] = (counts[e.topic] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    }, [filteredEntries]);

    const sentimentData = useMemo(() => {
      const counts: Record<string, number> = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
      filteredEntries.forEach(e => {
        counts[e.sentiment]++;
      });
      return [
        { name: 'Positive', count: counts.positive, color: 'var(--green)' },
        { name: 'Neutral', count: counts.neutral, color: 'var(--dim)' },
        { name: 'Negative', count: counts.negative, color: 'var(--red)' },
        { name: 'Mixed', count: counts.mixed, color: 'var(--purple)' }
      ];
    }, [filteredEntries]);

    const stats = useMemo(() => ({
      uniquePeople: new Set(filteredEntries.flatMap(e => e.people)).size,
      uniqueTopics: new Set(filteredEntries.map(e => e.topic)).size,
      avgScore: Math.round(filteredEntries.reduce((acc, e) => acc + e.score, 0) / (filteredEntries.length || 1))
    }), [filteredEntries]);

    return (
      <div className="space-y-8 animate-in">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-dark p-8 rounded-3xl flex flex-col justify-between border border-white/5 relative overflow-hidden group">
            <div className="relative z-10">
              <div className="text-[10px] tracking-[4px] text-[var(--amber)] uppercase font-bold mb-6 flex items-center gap-2">
                <Activity className="w-3 h-3" /> Archive Health
              </div>
              <div className="font-serif italic text-6xl text-[var(--text)] mb-2">{filteredEntries.length}</div>
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-[2px] font-bold">Active Records</div>
            </div>
            <div className="absolute -right-8 -bottom-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <LayoutGrid className="w-32 h-32" />
            </div>
          </div>

          <div className="glass-dark p-8 rounded-3xl flex flex-col justify-between border border-white/5 relative overflow-hidden group">
            <div className="relative z-10">
              <div className="text-[10px] tracking-[4px] text-[var(--cyan)] uppercase font-bold mb-6 flex items-center gap-2">
                <Users className="w-3 h-3" /> Social Graph
              </div>
              <div className="font-serif italic text-6xl text-[var(--text)] mb-2">{stats.uniquePeople}</div>
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-[2px] font-bold">Identified Entities</div>
            </div>
            <div className="absolute -right-8 -bottom-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Users className="w-32 h-32" />
            </div>
          </div>

          <div className="glass-dark p-8 rounded-3xl flex flex-col justify-between border border-white/5 relative overflow-hidden group">
            <div className="relative z-10">
              <div className="text-[10px] tracking-[4px] text-[var(--purple)] uppercase font-bold mb-6 flex items-center gap-2">
                <Hash className="w-3 h-3" /> Topic Density
              </div>
              <div className="font-serif italic text-6xl text-[var(--text)] mb-2">{stats.uniqueTopics}</div>
              <div className="text-[11px] text-[var(--muted)] uppercase tracking-[2px] font-bold">Unique Themes</div>
            </div>
            <div className="absolute -right-8 -bottom-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Hash className="w-32 h-32" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="glass-dark p-8 rounded-3xl border border-white/5">
            <div className="flex items-center justify-between mb-8">
              <div className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase font-bold">Sentiment Distribution</div>
              <div className="p-2 bg-white/5 rounded-lg"><BarChart3 className="w-4 h-4 text-[var(--amber)]" /></div>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sentimentData}>
                  <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--s1)', border: '1px solid var(--border)', borderRadius: '12px', fontSize: '10px' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {sentimentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-dark p-8 rounded-3xl border border-white/5">
            <div className="flex items-center justify-between mb-8">
              <div className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase font-bold">Top Themes</div>
              <div className="p-2 bg-white/5 rounded-lg"><PieChart className="w-4 h-4 text-[var(--cyan)]" /></div>
            </div>
            <div className="space-y-4">
              {topicData.slice(0, 6).map((t, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="text-[10px] font-mono text-[var(--muted)] w-8">0{i+1}</div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[11px] font-bold mb-1.5">
                      <span className="text-[var(--text)] uppercase tracking-wider">{t.name}</span>
                      <span className="text-[var(--muted)]">{t.count}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(t.count / (topicData[0]?.count || 1)) * 100}%` }}
                        className="h-full bg-[var(--cyan)]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const MessageRow = ({ index, style, data }: { index: number, style: React.CSSProperties, data: Entry[] }) => {
    const e = data[index];
    const isExpanded = expandedEntries.has(e.uId);
    
    return (
      <div style={style} className="px-4">
        <motion.div 
          layout
          onClick={() => toggleEntryExpand(e.uId)}
          className={`glass rounded-2xl p-6 mb-4 border transition-all relative overflow-hidden shadow-lg cursor-pointer ${isExpanded ? 'border-[var(--amber)] ring-1 ring-[var(--amber)]/20' : 'hover:border-[var(--amber)] border-[var(--border)]'}`}
        >
          <div className="flex items-center gap-3 text-[10px] tracking-[2px] text-[var(--muted)] mb-4 font-bold">
            <span 
              className={`px-3 py-1 rounded-lg uppercase text-[9px] ${
                e.sentiment === 'positive' ? 'bg-[rgba(16,185,129,0.1)] text-[var(--green)]' :
                e.sentiment === 'negative' ? 'bg-[rgba(239,68,68,0.1)] text-[var(--red)]' :
                'bg-[rgba(59,130,246,0.1)] text-[var(--blue)]'
              }`}
            >
              {e.sentiment}
            </span>
            <span 
              className="px-3 py-1 bg-[var(--dim)] text-[var(--text)] rounded-lg uppercase text-[9px]"
            >
              {e.topic}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Brain className="w-3.5 h-3.5 opacity-60 text-[var(--amber)]" />
              Score: <span className="text-[var(--amber)] font-black">{e.score}</span>
            </span>
            <button 
              onClick={(ev) => { ev.stopPropagation(); toggleHide(e.uId); }}
              className="ml-2 p-1.5 hover:bg-[var(--dim)] rounded-lg text-[var(--muted)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
              title="Hide from Archive"
            >
              <EyeOff className="w-4 h-4" />
            </button>
          </div>
          <div className={`text-sm leading-relaxed text-[var(--text)] whitespace-pre-wrap font-medium transition-all duration-300 ${isExpanded ? '' : 'line-clamp-3'}`}>
            {e.text}
          </div>
          {e.people.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {e.people.map(p => (
                <span 
                  key={p} 
                  className="text-[9px] text-[var(--cyan)] bg-[rgba(6,182,212,0.08)] px-2.5 py-1 rounded-lg border border-[rgba(6,182,212,0.1)] font-bold tracking-wider"
                >
                  @{p}
                </span>
              ))}
            </div>
          )}
          <div className={`absolute right-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-transparent via-[var(--amber)] to-transparent transition-opacity ${isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
        </motion.div>
      </div>
    );
  };
  const runAIExtract = async (retryBatches?: AIBatch[]) => {
    // Safety check: if called directly from onClick, retryBatches will be a React event object
    const actualRetryBatches = Array.isArray(retryBatches) ? retryBatches : undefined;
    
    setIsAiLoading(true);
    isAiLoadingRef.current = true;
    setAiProgress(actualRetryBatches ? 'Retrying failed chunks...' : 'Starting AI extraction...');
    
    let batchesToProcess: AIBatch[] = [];

    if (actualRetryBatches) {
      batchesToProcess = actualRetryBatches.map(b => ({ ...b, status: 'pending' as const }));
      setAiBatches(prev => prev.map(b => {
        const retry = batchesToProcess.find(rb => rb.id === b.id);
        return retry ? { ...b, status: 'pending' as const } : b;
      }));
    } else {
      const topEntries = filteredEntries;
      if (topEntries.length === 0) {
        showNotification("No entries to extract.", "error");
        setIsAiLoading(false);
        return;
      }
      
      const BATCH_SIZE = 15; // Increased batch size for speed
      const totalBatchesCount = Math.ceil(topEntries.length / BATCH_SIZE);
      const newBatches: AIBatch[] = [];
      for (let i = 0; i < totalBatchesCount; i++) {
        newBatches.push({
          id: i,
          chunk: topEntries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
          status: 'pending'
        });
      }
      setAiBatches(newBatches);
      batchesToProcess = newBatches;
      setAiStories([]);
      setAiRejectedStories([]);
      setGuardianFindings([]);
      setAiTotalProcessed(topEntries.length);
      setAiProcessedSoFar(0);
    }

    const processBatch = async (batch: AIBatch, attempt = 1): Promise<void> => {
      const MAX_RETRIES = 3;
      setAiBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'processing', error: undefined } : b));
      
      const inputText = batch.chunk.map((e, idx) => `[ID: ${idx}]\n${e.text}`).join('\n\n---\n\n');
      const prompt = `You are a helpful life curator. Extract genuine first-person life memories, personal stories, and explanations/corrections about life details.
The input is already pre-filtered, but perform a final cleaning to find the "gems".

CRITICAL: Keep entries that are personal stories, memories, or you explaining/correcting your own life details to the AI. These are valuable.
REJECT ONLY: Purely technical talk (code, logs), generic AI instructions (e.g. "summarize this"), bot-like behavior (repetition), or completely non-personal noise.
DO NOT REJECT stories just because they don't fit a specific theme or if they seem like "editing" or "correcting" info. If it's a personal memory or meaningful thought, KEEP IT. Even small nuances about life details are important.

Return ONLY valid JSON:
{
  "stories": [
    {"id": <ID from input>, "one_line": "<1 evocative sentence>", "theme": "<theme>", "emotion": "<emotion>", "timeframe": "<time>", "importance": 8}
  ],
  "rejected": [
    {"id": <ID from input>, "reason": "<one-word: Technical|AI-Talk|Repetitive|Greeting|Instruction|Bot-Freeze|Noise>", "explanation": "<detailed explanation why it was rejected>", "proof": "<specific snippet or evidence from the text that justifies the rejection>"}
  ]
}

Only include entries in "stories" if importance >= 2. Everything else goes in "rejected".

${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

${inputText}`;

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: modelConfig.scan,
          contents: {
            parts: [
              ...(isCustomPromptEnabled && customPromptFileData ? [{
                inlineData: {
                  data: customPromptFileData,
                  mimeType: customPromptMimeType || 'text/plain'
                }
              }] : []),
              { text: prompt }
            ]
          },
          config: { 
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // Faster processing
            tools: [{ googleSearch: {} }]
          }
        });
        
        trackUsage(modelConfig.scan, response);
        const parsed = safeJsonParse(response.text);
        
        if (parsed.stories) {
          const enrichedStories = parsed.stories.map((s: any) => {
            const originalEntry = batch.chunk[s.id];
            
            // Extract grounding for this specific story if possible
            // Note: Grounding is per-response, so it might apply to multiple stories
            const groundingUrls = response.candidates?.[0]?.groundingMetadata?.groundingChunks
              ?.map(chunk => chunk.web?.uri)
              .filter((uri): uri is string => !!uri);

            return {
              ...s,
              text: originalEntry ? originalEntry.text : "Text not found",
              sources: groundingUrls
            };
          }).filter((s: any) => s.text !== "Text not found");
          
          setAiStories(prev => [...prev, ...enrichedStories].sort((a: any, b: any) => b.importance - a.importance));
        }

        if (parsed.rejected) {
          const enrichedRejected = parsed.rejected.map((r: any) => {
            const originalEntry = batch.chunk[r.id];
            return {
              ...originalEntry,
              aiReason: r.reason,
              aiDetailedReason: r.explanation,
              aiProof: r.proof
            };
          }).filter((r: any) => r.text);
          setAiRejectedStories(prev => [...prev, ...enrichedRejected]);
        }

        if (isGuardianEnabled && parsed.rejected && parsed.rejected.length > 0) {
          const rejectedTexts = parsed.rejected.map((r: any) => {
            const originalEntry = batch.chunk[r.id];
            return `[ID: ${r.id}] Reason: ${r.reason}\nText: ${originalEntry?.text}`;
          }).filter((t: string) => !t.includes('undefined')).join('\n\n---\n\n');

          if (rejectedTexts) {
            const guardianPrompt = `You are the "Guardian AI". Your job is to monitor another AI that is filtering personal archives.
The other AI has rejected the following entries. Your task is to check if it made any MISTAKES.
Mistakes are entries that contain important life stories, critical personal information, emotional nuances, or subtle corrections to life details that should have been KEPT.

Focus Areas: ${guardianSettings.focusAreas}
Sensitivity: ${guardianSettings.sensitivity}/10

Rejected Entries:
${rejectedTexts}

Return ONLY valid JSON:
{
  "flagged": [
    {
      "id": <ID from input>,
      "reason": "<detailed reasoning why the other AI was wrong>",
      "proof": "<specific snippet from the text that proves this is important>",
      "suggested_importance": 8
    }
  ]
}`;

            try {
              const guardianResponse = await ai.models.generateContent({
                model: modelConfig.accuracy,
                contents: { parts: [{ text: guardianPrompt }] },
                config: { 
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingLevel: guardianSettings.thinkingLevel }
                }
              });
              trackUsage(modelConfig.accuracy, guardianResponse);
              const guardianParsed = safeJsonParse(guardianResponse.text);
              
              if (guardianParsed.flagged) {
                const findings = guardianParsed.flagged.map((f: any) => {
                  const originalEntry = batch.chunk[f.id];
                  return {
                    ...originalEntry,
                    guardianReason: f.reason,
                    guardianProof: f.proof,
                    suggestedImportance: f.suggested_importance,
                    status: 'flagged'
                  };
                }).filter((f: any) => f.text);
                setGuardianFindings(prev => [...prev, ...findings]);
              }
            } catch (ge) {
              console.error("Guardian AI error:", ge);
            }
          }
        }

        setAiBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'success' } : b));
        setAiProcessedSoFar(prev => prev + batch.chunk.length);
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          console.warn(`Batch ${batch.id} failed (attempt ${attempt}). Retrying...`, e);
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
          return processBatch(batch, attempt + 1);
        }
        console.error(`Error in batch ${batch.id} after ${MAX_RETRIES} attempts:`, e);
        setAiBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'error', error: String(e) } : b));
      }
    };

    // Process batches with concurrency control (reduced to 1 to avoid 429s)
    const concurrency = 1;
    const queue = [...batchesToProcess];
    const totalToProcess = batchesToProcess.length;
    let completedCount = 0;

    const workers = Array(Math.min(concurrency, queue.length)).fill(null).map(async () => {
      while (queue.length > 0) {
        if (!isAiLoadingRef.current) break;
        const batch = queue.shift();
        if (batch) {
          await processBatch(batch);
          if (!isAiLoadingRef.current) break;
          completedCount++;
          setAiProgress(`Processed ${completedCount} of ${totalToProcess} chunks...`);
          // Add a small delay between batches to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    });

    await Promise.all(workers);
    
    setIsAiLoading(false);
    isAiLoadingRef.current = false;
    setAiProgress('');
  };

  const runComparison = async (isRescan: any = false) => {
    // Handle React event object if called directly from onClick
    const actualIsRescan = typeof isRescan === 'boolean' ? isRescan : false;

    if (comparisonEntries.length === 0 || filteredEntries.length === 0) {
      showNotification("No source entries or comparison file available.", "error");
      return;
    }
    setIsComparing(true);
    setComparisonError(null);
    setComparisonSuccess(false);
    isComparingRef.current = true;
    
    if (!actualIsRescan) {
      setComparisonResults(null);
      setComparisonFindings([]);
      setComparisonThoughts([]);
    }
    
    const BATCH_SIZE = 20;
    // If rescan, we only check entries that weren't already flagged as missing
    const alreadyMissingTexts = new Set(comparisonFindings.map(f => f.entry.text));
    const sourceEntries = actualIsRescan 
      ? filteredEntries.filter(e => !alreadyMissingTexts.has(e.text)).slice(0, 200)
      : filteredEntries.slice(0, 200);

    if (sourceEntries.length === 0) {
      showNotification("No more entries to scan.", "info");
      setIsComparing(false);
      return;
    }

    const totalBatchesCount = Math.ceil(sourceEntries.length / BATCH_SIZE);
    
    const newBatches = [];
    for (let i = 0; i < totalBatchesCount; i++) {
      newBatches.push({
        id: i,
        status: 'pending',
        chunk: sourceEntries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      });
    }
    setComparisonBatches(newBatches);

    const newFileText = comparisonEntries.slice(0, 100).map((e, idx) => `[NEW_ID: ${idx}]\n${e.text}`).join('\n---\n');
    const currentBatchMissing: {
      entry: Entry, 
      reason: string, 
      newFileQuote?: string, 
      connectionReason?: string, 
      importanceReason?: string,
      sourceHighlight?: string,
      newFileHighlight?: string,
      newFileFullMessage?: string
    }[] = [];

    const processBatch = async (batch: any, attempt = 1): Promise<void> => {
      const MAX_RETRIES = 3;
      setComparisonBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'processing' } : b));
      
      const sourceText = batch.chunk.map((e: any, idx: number) => `[SOURCE_ID: ${idx}]\n${e.text}`).join('\n\n---\n\n');
      const prompt = `You are a highly sophisticated life archivist. I have a "Source Archive" (my main stories) and a "New File" (the one I just uploaded).
      Your goal is to perform a SEMANTIC GAP ANALYSIS with EXTREME DETAIL. 
      
      CRITICAL: Do NOT mark a story as missing just because the words are different. 
      People often tell the same story using different vocabulary, different levels of detail, or from a slightly different perspective.
      
      A story is ONLY "Missing" if the CORE EVENT, the SPECIFIC FACT, or the UNIQUE EMOTIONAL NUANCE is completely absent from the New File.
      
      If the New File contains a version of the story that is:
      - Paraphrased
      - Summarized
      - Mentioned briefly
      ...then it is NOT missing. It is "Present".
      
      Only flag it as "Missing" if the New File has NO mention of this specific life event or if the New File's version is so vague that the original meaning is lost.
      
      ${actualIsRescan ? "This is a DEEP RESCAN. Look for very subtle nuances that might have been lost in translation between versions." : ""}

      ${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

      New File Content (Context):
      ${newFileText}
      
      Source Archive Stories to check:
      ${sourceText}
      
      For each "Source Archive Story", determine if it is fully captured in the "New File".
      If it is MISSING or the "New File" only has a vague/incomplete version:
      1. Identify the SOURCE_ID.
      2. Provide a "reason": A VERY DETAILED explanation (2-3 sentences) of exactly what is missing or what nuance is lost.
      3. Find the related message in the New File:
         - "newFileId": The NEW_ID from the New File content that is most closely related to this story (even if it's a poor match). Use null if absolutely no mention exists.
         - "newFileQuote": The specific phrase in that New File message that relates to the story.
      4. Provide a "connectionReason": Detailed explanation of why the New File version is insufficient compared to the Source.
      5. Provide an "importanceReason": Why this specific missing nuance matters for the user's life story.
      6. Provide "sourceHighlight": The specific phrase in the Source Archive story that is the "heart" of what's missing.
      
      Return ONLY valid JSON:
      {
        "missing": [
          {
            "id": number, 
            "reason": "string", 
            "newFileId": number or null,
            "newFileQuote": "string or null", 
            "connectionReason": "string",
            "importanceReason": "string",
            "sourceHighlight": "string"
          },
          ...
        ]
      }
      If everything is present, return an empty array for "missing".`;

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response: any = await ai.models.generateContent({
          model: modelConfig.compare,
          contents: {
            parts: [
              ...(isCustomPromptEnabled && customPromptFileData ? [{
                inlineData: {
                  data: customPromptFileData,
                  mimeType: customPromptMimeType || 'text/plain'
                }
              }] : []),
              { text: prompt }
            ]
          },
          config: { 
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            tools: [{ googleSearch: {} }]
          }
        });
        
        trackUsage(modelConfig.compare, response);
        if (response.thought) {
          setComparisonThoughts(prev => [...prev, response.thought]);
        }

        const parsed = safeJsonParse(response.text);
          if (parsed.missing && Array.isArray(parsed.missing)) {
            const missingItems = parsed.missing
              .map((m: any) => {
                const entry = batch.chunk[m.id];
                const newFileEntry = m.newFileId !== null ? comparisonEntries[m.newFileId] : null;
                
                return {
                  entry,
                  reason: m.reason || m.explanation,
                  newFileQuote: m.newFileQuote,
                  connectionReason: m.connectionReason,
                  importanceReason: m.importanceReason,
                  sourceHighlight: m.sourceHighlight,
                  newFileFullMessage: newFileEntry ? newFileEntry.text : undefined
                };
              })
              .filter((m: any) => !!m.entry);
            
            currentBatchMissing.push(...missingItems);
            setComparisonFindings(prev => [...prev, ...missingItems]);
            if (missingItems.length > 0) {
              setComparisonLiveLog(prev => [`Found ${missingItems.length} missing stories in batch ${batch.id + 1}`, ...prev].slice(0, 5));
            } else {
              setComparisonLiveLog(prev => [`Batch ${batch.id + 1}: All stories present`, ...prev].slice(0, 5));
            }
          }
        
        setComparisonBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'success' } : b));
      } catch (e) {
        if (attempt < MAX_RETRIES) {
          console.warn(`Comparison batch ${batch.id} failed (attempt ${attempt}). Retrying...`, e);
          await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
          return processBatch(batch, attempt + 1);
        }
        console.error(`Error in comparison batch ${batch.id} after ${MAX_RETRIES} attempts:`, e);
        setComparisonBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'error' } : b));
      }
    };

    // Process with concurrency (reduced to 1 to avoid 429s)
    const queue = [...newBatches];
    const workers = Array(1).fill(null).map(async () => {
      while (queue.length > 0) {
        if (!isComparingRef.current) break;
        const batch = queue.shift();
        if (batch) {
          await processBatch(batch);
          if (!isComparingRef.current) break;
          // Add a small delay between batches to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    });

    await Promise.all(workers);
    
    if (!isComparingRef.current) return;

    // Update the final report based on ALL findings (accumulated)
    const allFindings = actualIsRescan ? [...comparisonFindings, ...currentBatchMissing] : currentBatchMissing;

    const finalReportPrompt = `Summarize these missing life stories into a cohesive "Gap Analysis Report". 
    The goal is to tell the user what specific life themes or events from their main archive are missing in the new file they uploaded.
    
    ${actualIsRescan ? "Note: This is an updated report including new nuances found in a deep rescan." : ""}

    ${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

    Missing Stories Context (Sample of findings):
    ${allFindings.slice(0, 40).map(m => `[Reason: ${m.reason}]\n${m.entry.text}`).join('\n---\n')}
    
    Format as a clean report with categories if possible.`;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const finalResponse = await ai.models.generateContent({
        model: modelConfig.compare,
        contents: {
          parts: [
            ...(isCustomPromptEnabled && customPromptFileData ? [{
              inlineData: {
                data: customPromptFileData,
                mimeType: customPromptMimeType || 'text/plain'
              }
            }] : []),
            { text: finalReportPrompt }
          ]
        },
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      trackUsage(modelConfig.compare, finalResponse);
      setComparisonResults(finalResponse.text);
      setComparisonSuccess(true);
      showNotification(actualIsRescan ? "Deep rescan complete. Report updated." : "Comparison complete.", "success");
    } catch (e) {
      setComparisonError(e instanceof Error ? e.message : String(e));
      setComparisonResults("Gap analysis complete. See the full missing messages below.");
    }
    
    setIsComparing(false);
    isComparingRef.current = false;
  };

  const runAccuracyCheck = async (isRescan: any = false) => {
    // Handle React event object if called directly from onClick
    const actualIsRescan = typeof isRescan === 'boolean' ? isRescan : false;

    if (filteredEntries.length === 0) {
      showNotification("No source entries available. Please upload and filter your archive first.", "error");
      return;
    }
    if (!accDocFile) {
      showNotification("Please upload the document to check.", "error");
      return;
    }
    
    setIsAccChecking(true);
    setAccuracyError(null);
    setAccuracySuccess(false);
    isAccCheckingRef.current = true;
    if (!actualIsRescan) {
      setAccResults(null);
      setAccFindings([]);
      setAccThoughts([]);
    }
    
    try {
      const docText = await accDocFile.text();
      const BATCH_SIZE = 15;
      
      // If rescan, we might want to focus on entries that weren't already checked or were uncertain
      const alreadyCheckedTexts = new Set(accFindings.map(f => f.entry.text));
      const sourceEntries = actualIsRescan 
        ? filteredEntries.filter(e => !alreadyCheckedTexts.has(e.text)).slice(0, 200)
        : filteredEntries.slice(0, 200);

      if (sourceEntries.length === 0) {
        showNotification("No more entries to scan.", "info");
        setIsAccChecking(false);
        return;
      }

      const totalBatchesCount = Math.ceil(sourceEntries.length / BATCH_SIZE);
      
      const newBatches = [];
      for (let i = 0; i < totalBatchesCount; i++) {
        newBatches.push({
          id: i,
          status: 'pending',
          chunk: sourceEntries.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        });
      }
      setAccBatches(newBatches);

        const processBatch = async (batch: any, attempt = 1): Promise<void> => {
        const MAX_RETRIES = 3;
        setAccBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'processing' } : b));
        
        const sourceText = batch.chunk.map((e: any, idx: number) => `[SOURCE_ID: ${idx}]\n${e.text}`).join('\n\n---\n\n');
        const prompt = `You are a document accuracy checker for Erhan Yildirim's life story.
Compare the "Source Archive" (raw words) against the "Document v111" (AI written life story).

Your job is to identify how accurately these specific source entries are represented in the document.

For each source entry, categorize it as:
- MATCHES: Accurately reflects his raw words.
- DISTORTED: Present but changed, made more certain, or interpreted beyond what he said.
- MISSING: Not in the document at all.
- UNCERTAIN: Cannot clearly assign.

Also, if you notice anything in the document that is INVENTED (not supported by ANY source text), flag it.

Rules:
Never interpret. Never connect dots. Never add meaning. If it is not in the raw files it is invented. If he said something uncertain or half believing in the raw files, v111 must reflect that same uncertainty — if it doesn't, flag it as distorted. Typos and messy language in raw files do not change the meaning — read for what he meant not how he wrote it. Dutch words stay Dutch. His uncertainty stays uncertain. His half beliefs stay half beliefs. Nothing gets resolved that he didn't resolve himself.
Output only what is wrong. If something fully matches, you can note it briefly but focus on the problems. Be specific. Quote both versions side by side so he can see exactly what changed.

${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

Document v111:
${docText}

Source Archive Entries to check:
${sourceText}

Return ONLY valid JSON:
{
  "findings": [
    {
      "id": <SOURCE_ID>,
      "category": "MATCHES|DISTORTED|MISSING|UNCERTAIN",
      "reason": "Detailed explanation of why it falls into this category",
      "docQuote": "The specific phrase in Document v111 that relates to this (if any)",
      "sourceQuote": "The specific phrase in Source Archive that is the focus"
    }
  ],
  "invented": [
    {
      "docQuote": "Phrase in document that seems invented",
      "reason": "Why it seems invented"
    }
  ]
}`;

        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response: any = await ai.models.generateContent({
            model: modelConfig.accuracy,
            contents: {
              parts: [
                ...(isCustomPromptEnabled && customPromptFileData ? [{
                  inlineData: {
                    data: customPromptFileData,
                    mimeType: customPromptMimeType || 'text/plain'
                  }
                }] : []),
                { text: prompt }
              ]
            },
            config: { 
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
              tools: [{ googleSearch: {} }]
            }
          });
          
          trackUsage(modelConfig.accuracy, response);
          if (response.thought) {
            setAccThoughts(prev => [...prev, response.thought]);
          }

          const parsed = safeJsonParse(response.text);
          if (parsed.findings && Array.isArray(parsed.findings)) {
            const enrichedFindings = parsed.findings.map((f: any) => ({
              ...f,
              entry: batch.chunk[f.id]
            })).filter((f: any) => !!f.entry);
            setAccFindings(prev => [...prev, ...enrichedFindings]);
            
            const distortions = enrichedFindings.filter((f: any) => f.category === 'DISTORTED').length;
            const missing = enrichedFindings.filter((f: any) => f.category === 'MISSING').length;
            setAccLiveLog(prev => [`Batch ${batch.id + 1}: Found ${distortions} distortions, ${missing} missing`, ...prev].slice(0, 5));
          }
          
          setAccBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'success' } : b));
        } catch (e) {
          if (attempt < MAX_RETRIES) {
            console.warn(`Accuracy batch ${batch.id} failed (attempt ${attempt}). Retrying...`, e);
            await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
            return processBatch(batch, attempt + 1);
          }
          console.error(`Error in accuracy batch ${batch.id} after ${MAX_RETRIES} attempts:`, e);
          setAccBatches(prev => prev.map(b => b.id === batch.id ? { ...b, status: 'error' } : b));
        }
      };

      const queue = [...newBatches];
      const workers = Array(1).fill(null).map(async () => {
        while (queue.length > 0) {
          if (!isAccCheckingRef.current) break;
          const batch = queue.shift();
          if (batch) {
            await processBatch(batch);
            if (!isAccCheckingRef.current) break;
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      });

      await Promise.all(workers);
      
      if (!isAccCheckingRef.current) return;

      // Final summary
      const allFindings = accFindings;
      const finalPrompt = `Summarize these accuracy findings into a cohesive "Accuracy Report".
      Highlight the main distortions, missing pieces, and any invented content found.
      
      ${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}

      Findings Sample:
      ${allFindings.slice(0, 40).map(f => `[${f.category}] ${f.reason}\nSource: ${f.entry.text}`).join('\n---\n')}
      
      Format as a clean Markdown report.`;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const finalResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            ...(isCustomPromptEnabled && customPromptFileData ? [{
              inlineData: {
                data: customPromptFileData,
                mimeType: customPromptMimeType || 'text/plain'
              }
            }] : []),
            { text: finalPrompt }
          ]
        },
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      
      setAccResults(finalResponse.text);
      setAccuracySuccess(true);
      showNotification(actualIsRescan ? "Deep rescan complete. Report updated." : "Accuracy check complete.", "success");
    } catch (e) {
      console.error(e);
      setAccuracyError(e instanceof Error ? e.message : String(e));
      showNotification("Failed to run accuracy check.", "error");
    } finally {
      setIsAccChecking(false);
      isAccCheckingRef.current = false;
    }
  };

  const generateClaudeSynthesis = async () => {
    if (!comparisonResults && !accResults) {
      showNotification("Run Comparison or Accuracy Check first to synthesize results.", "error");
      return;
    }

    setIsSynthesizing(true);
    try {
      const prompt = `You are preparing a "Master Edit Instruction" for Claude (another AI model).
      Claude's job is to take the "Life Document" and perform a final, definitive edit.
      
      I will provide you with:
      1. Gap Analysis (What is missing from the document)
      2. Accuracy Report (What is wrong/hallucinated in the document)
      3. Source Evidence (Specific quotes and proof)
      
      Your goal is to synthesize all this into a single, high-quality instruction set that Claude can follow.
      Claude needs to know:
      - Exactly what to add (with source quotes as proof).
      - Exactly what to fix (with side-by-side comparisons of source vs document).
      - The tone and style that must be maintained.
      
      Gap Analysis:
      ${comparisonResults || 'Not available'}
      
      Accuracy Report:
      ${accResults || 'Not available'}
      
      Source Evidence (Missing):
      ${comparisonFindings.slice(0, 50).map(f => `[MISSING] ${f.reason}\nSOURCE PROOF: "${f.entry.text}"`).join('\n\n')}
      
      Source Evidence (Accuracy):
      ${accFindings.slice(0, 50).map(f => `[${f.category}] ${f.reason}\nSOURCE: "${f.sourceQuote}"\nDOCUMENT: "${f.docQuote}"`).join('\n\n')}
      
      Format the output as a "Claude Master Edit Prompt". It should be structured, authoritative, and provide all necessary evidence.`;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts: [{ text: prompt }] },
        config: { 
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          tools: [{ googleSearch: {} }]
        }
      });
      
      setClaudeSynthesis(response.text);
      showNotification("Claude Synthesis generated. Ready for final edit.", "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to generate Claude Synthesis.", "error");
    } finally {
      setIsSynthesizing(false);
    }
  };

  const downloadComparisonReport = (isMd: boolean) => {
    if (!comparisonResults && comparisonFindings.length === 0) return;
    
    // Calculate some analytics
    const totalSource = filteredEntries.length;
    const missingCount = comparisonFindings.length;
    const coverage = totalSource > 0 ? Math.round(((totalSource - missingCount) / totalSource) * 100) : 0;
    
    const topicCounts: Record<string, number> = {};
    comparisonFindings.forEach(f => {
      topicCounts[f.entry.topic] = (topicCounts[f.entry.topic] || 0) + 1;
    });
    
    let content = '';
    if (isMd) {
      content = '# Gap Analysis Report: Missing Life Information\n\n';
      content += `*Generated on: ${new Date().toLocaleString()}*\n\n`;
      
      content += '## Analytics & Coverage\n';
      content += `- **Total Archive Entries Checked:** ${totalSource}\n`;
      content += `- **Missing Stories Identified:** ${missingCount}\n`;
      content += `- **Estimated Coverage in New File:** ${coverage}%\n\n`;
      
      content += '### Missing Topics Breakdown\n';
      Object.entries(topicCounts).forEach(([topic, count]) => {
        content += `- **${topic}:** ${count} messages\n`;
      });
      content += '\n---\n\n';
      
      content += '## Summary Analysis\n\n';
      content += (comparisonResults || 'No summary generated.') + '\n\n';
      content += '---\n\n';
      content += '## Source Evidence (Proof from Archive)\n\n';
      comparisonFindings.forEach((f, i) => {
        content += `### ${i+1}. Missing Detail: ${f.reason}\n\n`;
        content += `**Source:** ${f.entry.source} · **Score:** ${f.entry.score} · **Topic:** ${f.entry.topic}\n\n`;
        content += `> ${f.entry.text}\n\n---\n\n`;
      });
    } else {
      content = 'GAP ANALYSIS REPORT: MISSING LIFE INFORMATION\n';
      content += '='.repeat(60) + '\n';
      content += `Generated on: ${new Date().toLocaleString()}\n\n`;
      
      content += 'ANALYTICS & COVERAGE\n';
      content += `Total Archive Entries Checked: ${totalSource}\n`;
      content += `Missing Stories Identified: ${missingCount}\n`;
      content += `Estimated Coverage in New File: ${coverage}%\n\n`;
      
      content += 'MISSING TOPICS BREAKDOWN\n';
      Object.entries(topicCounts).forEach(([topic, count]) => {
        content += `- ${topic.toUpperCase()}: ${count}\n`;
      });
      content += '\n' + '-'.repeat(40) + '\n\n';
      
      content += 'SUMMARY ANALYSIS\n';
      content += (comparisonResults || 'No summary generated.') + '\n\n';
      content += 'SOURCE EVIDENCE (PROOF FROM ARCHIVE)\n';
      content += '-'.repeat(40) + '\n\n';
      comparisonFindings.forEach((f, i) => {
        content += `${i+1}. REASON: ${f.reason.toUpperCase()}\n`;
        content += `SOURCE: ${f.entry.source} | SCORE: ${f.entry.score} | TOPIC: ${f.entry.topic}\n\n`;
        content += `${f.entry.text}\n\n`;
        content += '─'.repeat(30) + '\n\n';
      });
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gap_analysis_${new Date().toISOString().slice(0,10)}.${isMd ? 'md' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAccuracyFile = async (file: File | { name: string, text: () => Promise<string> }) => {
    if (!file) return;
    try {
      if (file instanceof File) {
        await saveToHistory(file, 'accuracy');
      }
      setAccDocFile(file as any);
      refreshHistory();
      showNotification(`Selected ${file.name} for accuracy check.`, "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to load accuracy file.", "error");
    }
  };

  const handleComparisonFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    
    const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40MB limit per file
    const oversizedFiles = fileList.filter(f => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      showNotification(`Skipped ${oversizedFiles.length} file(s) larger than 40MB to prevent crash.`, "error");
    }
    
    const validFiles = fileList.filter(f => f.size <= MAX_FILE_SIZE);
    if (validFiles.length === 0) return;

    showNotification(`Processing ${validFiles.length} file(s) for comparison...`, "info");
    setIsComparing(true);
    setFileProcessingProgress(0);
    
    try {
      setComparisonResults(null);
      let allNewEntries: Entry[] = [];
      const MAX_TOTAL_ENTRIES = 15000; // Reduced for stability
      
      for (let fIdx = 0; fIdx < validFiles.length; fIdx++) {
        const file = validFiles[fIdx];
        try {
          if (file instanceof File) {
            await saveToHistory(file, 'compare');
          }
          const text = await file.text();
          let parsedEntries: any[] = [];
          if (file.name.endsWith('.json')) {
            try {
              parsedEntries = extractFromJSON(safeJsonParse(text), file.name);
            } catch {
              parsedEntries = extractFromText(text, file.name);
            }
          } else {
            parsedEntries = extractFromText(text, file.name);
          }
          
          const CHUNK_SIZE = 500;
          for (let i = 0; i < parsedEntries.length; i += CHUNK_SIZE) {
            const chunk = parsedEntries.slice(i, i + CHUNK_SIZE);
            const processedChunk = chunk.map(e => ({
              ...e,
              uId: Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
              score: scoreEntry(e.text),
              sentiment: getSentiment(e.text),
              topic: detectTopics(e.text),
              people: detectPeopleInText(e.text),
              textLower: e.text.toLowerCase()
            }));
            
            allNewEntries = allNewEntries.concat(processedChunk);
            
            const fileProgress = (fIdx / fileList.length) * 100;
            const chunkProgress = (i / parsedEntries.length) * (100 / fileList.length);
            setFileProcessingProgress(Math.min(99, fileProgress + chunkProgress));

            if (i % (CHUNK_SIZE * 2) === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }

            if (allNewEntries.length > MAX_TOTAL_ENTRIES) {
              showNotification("Reached maximum entry limit for comparison.", "info");
              break;
            }
          }
          if (allNewEntries.length > MAX_TOTAL_ENTRIES) break;
        } catch (e) {
          console.error(e);
        }
      }
      setFileProcessingProgress(100);
      setComparisonEntries(allNewEntries.slice(0, MAX_TOTAL_ENTRIES));
      refreshHistory();
      showNotification(`Uploaded ${allNewEntries.length} entries for comparison. Ready to scan.`, "success");
    } catch (e) {
      console.error(e);
      showNotification("Failed to process comparison files.", "error");
    } finally {
      setIsComparing(false);
      setTimeout(() => setFileProcessingProgress(0), 1000);
    }
  };

  const downloadInstantText = (isMd: boolean) => {
    let content = '';
    if (isMd) {
      content = '# My Life Stories\n\n';
      filteredEntries.forEach(e => {
        content += `> Score: ${e.score} · Topic: ${e.topic} · Sentiment: ${e.sentiment}\n\n${e.text}\n\n---\n\n`;
      });
    } else {
      content = 'MY LIFE STORIES\n' + '='.repeat(60) + '\n\n';
      filteredEntries.forEach(e => {
        content += `[Score: ${e.score} | Topic: ${e.topic} | Sentiment: ${e.sentiment}]\n${e.text}\n\n${'─'.repeat(40)}\n\n`;
      });
    }
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life_stories_${new Date().toISOString().slice(0,10)}.${isMd ? 'md' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  function handleAddExcl() {
    if (!exclInput.trim()) return;
    setExcludedWords(prev => [...new Set([...prev, exclInput.trim().toLowerCase()])]);
    setExclInput('');
  }

  const getActiveAIs = () => {
    const active = [];
    if (isAiLoading) active.push('Analyzing Archive');
    if (isComparing) active.push('Comparing Files');
    if (isAccChecking) active.push('Checking Accuracy');
    if (isChatLoading) active.push('Neural Chat Active');
    if (isGuardianEnabled) active.push('Guardian AI Shield');
    if (isSummarizing) active.push('Synthesizing Summary');
    
    // Check for "Advanced AI" (Pro models)
    const isAdvanced = Object.values(modelConfig).some(m => m.includes('pro'));
    if (isAdvanced) active.push('Advanced Reasoning Active');
    
    return active;
  };

  const showNotification = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const triggerConfirm = (id: string, callback: () => void) => {
    if (confirmState[id]) {
      callback();
      setConfirmState(prev => ({ ...prev, [id]: false }));
    } else {
      setConfirmState(prev => ({ ...prev, [id]: true }));
      setTimeout(() => setConfirmState(prev => ({ ...prev, [id]: false })), 3000);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    
    const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40MB limit per file
    const oversizedFiles = fileList.filter(f => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
      showNotification(`Skipped ${oversizedFiles.length} file(s) larger than 40MB to prevent crash.`, "error");
    }
    
    const validFiles = fileList.filter(f => f.size <= MAX_FILE_SIZE);
    if (validFiles.length === 0) return;

    showNotification(`Processing ${validFiles.length} file(s)...`, "info");
    setIsProcessingFiles(true);
    setFileProcessingProgress(0);
    
    try {
      let allNewProcessed: Entry[] = [];
      const MAX_TOTAL_ENTRIES = 15000; // Reduced from 25000 for stability
      
      for (let fIdx = 0; fIdx < validFiles.length; fIdx++) {
        const file = validFiles[fIdx];
        try {
          if (file instanceof File) {
            await saveToHistory(file, 'source');
          }
          const text = await file.text();
          let parsedEntries: any[] = [];
          
          if (file.name.endsWith('.json')) {
            try {
              parsedEntries = extractFromJSON(safeJsonParse(text), file.name);
            } catch {
              parsedEntries = extractFromText(text, file.name);
            }
          } else {
            parsedEntries = extractFromText(text, file.name);
          }
          
          // Process in smaller chunks to avoid blocking UI thread
          const CHUNK_SIZE = 250; // Smaller chunks for better responsiveness
          for (let i = 0; i < parsedEntries.length; i += CHUNK_SIZE) {
            const chunk = parsedEntries.slice(i, i + CHUNK_SIZE);
            const processedChunk = chunk.map(e => ({
              ...e,
              uId: Math.random().toString(36).substring(2, 11) + Date.now().toString(36),
              score: scoreEntry(e.text),
              sentiment: getSentiment(e.text),
              topic: detectTopics(e.text),
              people: detectPeopleInText(e.text),
              textLower: e.text.toLowerCase()
            }));
            
            allNewProcessed.push(...processedChunk);
            
            // Calculate overall progress
            const fileProgress = (fIdx / fileList.length) * 100;
            const chunkProgress = (i / parsedEntries.length) * (100 / fileList.length);
            setFileProcessingProgress(Math.min(99, fileProgress + chunkProgress));

            // Yield to UI thread more frequently
            await new Promise(resolve => setTimeout(resolve, 0));

            if (entries.length + allNewProcessed.length > MAX_TOTAL_ENTRIES) {
              showNotification("Reached maximum entry limit. Some data was skipped to prevent crash.", "info");
              break;
            }
          }
          
          if (entries.length + allNewProcessed.length > MAX_TOTAL_ENTRIES) break;
        } catch (e) {
          console.error("Failed to process file", e);
          showNotification(`Failed to process ${file.name}: ${String(e)}`, "error");
        }
      }
      
      setFileProcessingProgress(100);
      setEntries(prev => {
        const combined = prev.concat(allNewProcessed);
        return combined.slice(0, MAX_TOTAL_ENTRIES);
      });
      refreshHistory();
    } catch (e) {
      console.error(e);
      showNotification("Failed to load files.", "error");
    } finally {
      setIsProcessingFiles(false);
      setTimeout(() => setFileProcessingProgress(0), 1000);
    }
  };

  const downloadAIText = (isMd: boolean) => {
    let content = '';
    if (isMd) {
      content = '# My Life Stories — AI Extracted\n\n';
      aiStories.forEach((s, i) => {
        content += `## ${i+1}. ${s.one_line}\n\n*Theme: ${s.theme} · Emotion: ${s.emotion} · Timeframe: ${s.timeframe} · Importance: ${s.importance}/10*\n\n${s.text}\n\n---\n\n`;
      });
    } else {
      content = 'MY LIFE STORIES — AI EXTRACTED\n' + '='.repeat(60) + '\n\n';
      aiStories.forEach((s, i) => {
        content += `[ ${i+1}. ${s.one_line.toUpperCase()} ]\nTheme: ${s.theme} | Emotion: ${s.emotion} | Importance: ${s.importance}/10\n\n${s.text}\n\n${'─'.repeat(40)}\n\n`;
      });
    }
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life_stories_ai_${new Date().toISOString().slice(0,10)}.${isMd ? 'md' : 'txt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    
    const msg = chatInput.trim();
    setChatInput('');
    setIsChatLoading(true);
    
    const newHistory = [...chatHistory, { role: 'user', content: msg }];
    setChatHistory(newHistory);
    
    // Simple RAG: find relevant stories based on keywords in the message
    const keywords = msg.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    let relevantEntries = aiStories.length > 0 ? aiStories : filteredEntries;
    
    if (keywords.length > 0) {
      relevantEntries = relevantEntries.filter(e => {
        const text = (e.text || '').toLowerCase();
        return keywords.some(k => text.includes(k));
      });
    }
    
    // Fallback to top entries if no matches found or too few matches
    if (relevantEntries.length < 5) {
      relevantEntries = aiStories.length > 0 ? aiStories : filteredEntries;
    }

    const ctx = relevantEntries.slice(0, 25).map((s, i) => `[Story ${i+1}] ${s.text}`).join('\n\n');
    const sys = `You are an empathetic AI that has read someone's personal life stories.
    
    Context:
    ${ctx}
    
    Be warm, specific, reference actual details. Speak directly to the person. Keep responses 100-200 words.
    
    CRITICAL: You have access to Google Search. If the user asks about something you don't know or if you need more context about a life detail (like a place, a date, or a person), USE THE SEARCH TOOL. Don't guess.
    
    ${isCustomPromptEnabled && customPromptText ? `USER CUSTOM INSTRUCTIONS (MUST FOLLOW):\n${customPromptText}\n\n` : ''}`;
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: modelConfig.chat,
        contents: [
          ...(isCustomPromptEnabled && customPromptFileData ? [{
            role: 'user',
            parts: [{
              inlineData: {
                data: customPromptFileData,
                mimeType: customPromptMimeType || 'text/plain'
              }
            }]
          }] : []),
          ...newHistory.map(h => ({ 
            role: h.role === 'assistant' ? 'model' : 'user', 
            parts: [{ text: h.content }] 
          }))
        ],
        config: { 
          systemInstruction: sys,
          tools: isWebSearchEnabled ? [{ googleSearch: {} }] : []
        }
      });
      
      const groundingUrls = response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.map(chunk => chunk.web?.uri)
        .filter((uri): uri is string => !!uri);

      setChatHistory([...newHistory, { 
        role: 'assistant', 
        content: response.text,
        sources: groundingUrls 
      }]);
    } catch (e) {
      console.error(e);
      setChatHistory([...newHistory, { role: 'assistant', content: 'Error: Could not reach AI.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-[var(--amber)] selection:text-black overflow-x-hidden">
      {/* Active AI Status Indicator */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {getActiveAIs().map((status, i) => (
            <motion.div
              key={status}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-xl shadow-2xl"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse shadow-[0_0_8px_var(--amber)]"></div>
              <span className="text-[9px] font-mono font-bold uppercase tracking-[2px] text-[var(--amber)]">{status}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-24 pt-16 relative z-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
        <div>
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="font-serif italic text-6xl sm:text-8xl font-bold leading-none bg-gradient-to-r from-[var(--amber)] to-[var(--amber-g)] text-transparent bg-clip-text mb-2 tracking-tighter"
          >
            Memoria
          </motion.div>
          <div className="text-[11px] tracking-[6px] text-[var(--muted)] uppercase font-mono font-bold">Deep Intelligence Archive</div>
        </div>
        
        <div className="flex flex-wrap gap-6 items-center">
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold mb-1">System Status</span>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse shadow-[0_0_8px_var(--green)]"></div>
              <span className="text-[10px] font-mono text-[var(--text)] uppercase tracking-tighter">Neural Engine Active</span>
            </div>
          </div>
          <div className="w-px h-8 bg-[var(--border)] hidden md:block"></div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold mb-1">Total Records</span>
            <span className="text-[12px] font-mono text-[var(--amber)] font-bold uppercase">{entries.length.toLocaleString()} Entries</span>
          </div>
          <div className="w-px h-8 bg-[var(--border)] hidden md:block"></div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold mb-1">Total Removed</span>
            <span className="text-[12px] font-mono text-[var(--red)] font-bold uppercase">{filteredData.removed.length.toLocaleString()} Filtered</span>
          </div>
          <div className="w-px h-8 bg-[var(--border)] hidden md:block"></div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold mb-1">Total Left</span>
            <span className="text-[12px] font-mono text-[var(--green)] font-bold uppercase">{filteredData.kept.length.toLocaleString()} Active</span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {guardianFindings.some(f => f.status === 'flagged') && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={() => setActiveTab('guardian')}
            className="mb-8 glass rounded-3xl p-6 border border-[var(--red)]/30 bg-[rgba(239,68,68,0.05)] flex items-center justify-between cursor-pointer hover:bg-[rgba(239,68,68,0.1)] transition-all group shadow-2xl shadow-red-900/10"
          >
            <div className="flex items-center gap-6">
              <div className="w-14 h-14 rounded-full bg-[var(--red)]/10 flex items-center justify-center text-[var(--red)] group-hover:scale-110 transition-transform relative">
                <Activity className="w-7 h-7" />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--red)] rounded-full border-2 border-[var(--bg)] animate-pulse"></div>
              </div>
              <div>
                <div className="text-[12px] font-bold text-[var(--text)] uppercase tracking-[2px] mb-1">Guardian AI Flagged Mistakes</div>
                <div className="text-[11px] text-[var(--muted)] leading-relaxed">
                  The Advanced Guardian AI has identified <span className="text-[var(--red)] font-bold">{guardianFindings.filter(f => f.status === 'flagged').length} potential errors</span> in the current scan. 
                  These entries may contain critical life stories that were incorrectly filtered.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[var(--red)] text-[10px] font-bold uppercase tracking-[2px] bg-white/5 px-6 py-3 rounded-2xl group-hover:bg-white/10 transition-all">
              Review & Restore <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mb-12">
        <div className="flex glass-dark rounded-2xl overflow-hidden shadow-2xl flex-wrap p-1.5 gap-1.5">
          {[
            { id: 'instant', label: 'Scan', icon: <LayoutGrid className="w-4 h-4" /> },
            { id: 'dashboard', label: 'Insights', icon: <BarChart3 className="w-4 h-4" /> },
            { 
              id: 'ai-suite', 
              label: 'AI Suite', 
              icon: <Brain className="w-4 h-4" />,
              isGroup: true,
              children: [
                { id: 'chat', label: 'Conversation AI', icon: <MessageSquare className="w-4 h-4" /> },
                { id: 'compare', label: 'Comparison AI', icon: <GitCompare className="w-4 h-4" /> },
                { id: 'analysis', label: 'Analyze AI', icon: <Brain className="w-4 h-4" /> },
                { id: 'accuracy', label: 'Accuracy AI', icon: <CheckCircle2 className="w-4 h-4" /> },
                { id: 'guardian', label: 'Guardian AI', icon: <Activity className="w-4 h-4" /> }
              ]
            },
            { id: 'removed', label: 'Filters', icon: <Filter className="w-4 h-4" /> },
            { id: 'source', label: 'Source', icon: <Code className="w-4 h-4" /> }
          ].map(tab => {
            const isAiSuiteActive = activeTab === 'chat' || activeTab === 'compare' || activeTab === 'analysis' || activeTab === 'accuracy' || activeTab === 'guardian';
            const isActive = tab.id === 'ai-suite' ? isAiSuiteActive : (activeTab === tab.id || (tab.id === 'instant' && (activeTab === 'prompt' || activeTab === 'ai-settings')));

            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'instant') {
                    const isCurrentlyInScanGroup = activeTab === 'instant' || activeTab === 'prompt' || activeTab === 'ai-settings';
                    if (isCurrentlyInScanGroup) {
                      setIsScanMenuOpen(!isScanMenuOpen);
                    } else {
                      setActiveTab('instant');
                      setIsScanMenuOpen(false);
                    }
                    setIsAiSuiteOpen(false);
                  } else if (tab.id === 'ai-suite') {
                    if (isAiSuiteActive) {
                      setIsAiSuiteOpen(!isAiSuiteOpen);
                    } else {
                      setActiveTab('chat');
                      setIsAiSuiteOpen(false);
                    }
                    setIsScanMenuOpen(false);
                  } else {
                    setActiveTab(tab.id);
                    setIsScanMenuOpen(false);
                    setIsAiSuiteOpen(false);
                  }
                }}
                className={`flex-1 py-3.5 px-3 rounded-xl text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase cursor-pointer transition-all flex items-center justify-center gap-3 hover:text-[var(--text)] hover:bg-white/5 ${isActive ? 'text-[var(--amber)] bg-white/5 border border-white/5' : ''}`}
              >
                <div className="relative">
                  {tab.icon}
                  {(tab.id === 'instant' || tab.id === 'ai-suite') && (
                    <div className="absolute -right-1 -bottom-1">
                      <ChevronDown className={`w-2 h-2 transition-transform ${(tab.id === 'instant' ? isScanMenuOpen : isAiSuiteOpen) ? 'rotate-180' : ''}`} />
                    </div>
                  )}
                  {/* Status Indicator Dot */}
                  {(tab as any).status && (tab as any).status !== 'idle' && (
                    <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-[var(--bg)] shadow-sm ${
                      (tab as any).status === 'processing' ? 'bg-amber-500 animate-pulse' :
                      (tab as any).status === 'error' ? 'bg-red-500' :
                      'bg-emerald-500'
                    }`} />
                  )}
                </div>
                <span className="hidden lg:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence>
          {isScanMenuOpen && (
            <motion.div
              ref={scanMenuRef}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute left-0 top-full mt-2 w-48 glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
            >
              <button
                onClick={() => {
                  setActiveTab('instant');
                  setIsScanMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-[10px] font-mono font-bold tracking-[2px] uppercase transition-all hover:bg-[var(--s2)] ${activeTab === 'instant' ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
              >
                <LayoutGrid className="w-4 h-4" />
                Scan Archive
              </button>
              <button
                onClick={() => {
                  setActiveTab('prompt');
                  setIsScanMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-[10px] font-mono font-bold tracking-[2px] uppercase transition-all hover:bg-[var(--s2)] ${activeTab === 'prompt' ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
              >
                <Brain className="w-4 h-4" />
                AI Prompt
              </button>
              <button
                onClick={() => {
                  setActiveTab('ai-settings');
                  setIsScanMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-[10px] font-mono font-bold tracking-[2px] uppercase transition-all hover:bg-[var(--s2)] ${activeTab === 'ai-settings' ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
              >
                <Settings className="w-4 h-4" />
                AI Settings
              </button>
            </motion.div>
          )}

          {isAiSuiteOpen && (
            <motion.div
              ref={aiSuiteMenuRef}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
            >
              {[
                { id: 'chat', label: 'Conversation AI', icon: <MessageSquare className="w-4 h-4" /> },
                { id: 'compare', label: 'Comparison AI', icon: <GitCompare className="w-4 h-4" /> },
                { id: 'analysis', label: 'Analyze AI', icon: <Brain className="w-4 h-4" /> },
                { id: 'accuracy', label: 'Accuracy AI', icon: <CheckCircle2 className="w-4 h-4" /> },
                { id: 'guardian', label: 'Guardian AI', icon: <Activity className="w-4 h-4" /> }
              ].map(subTab => (
                <button
                  key={subTab.id}
                  onClick={() => {
                    setActiveTab(subTab.id);
                    setIsAiSuiteOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-[10px] font-mono font-bold tracking-[2px] uppercase transition-all hover:bg-[var(--s2)] ${activeTab === subTab.id ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
                >
                  {subTab.icon}
                  {subTab.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'ai-settings' && (
            <div className="space-y-8 animate-in fade-in duration-700">
              <div className="glass rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase flex items-center gap-3 font-bold">
                    <Settings className="w-4 h-4 text-[var(--amber)]" /> AI Model Configuration
                  </h3>
                  <button 
                    onClick={() => setIsAiOptionsCollapsed(!isAiOptionsCollapsed)}
                    className="p-2 hover:bg-white/5 rounded-full transition-colors text-[var(--muted)] hover:text-[var(--text)]"
                    title={isAiOptionsCollapsed ? "Expand Options" : "Collapse Options"}
                  >
                    {isAiOptionsCollapsed ? <ChevronDown className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </button>
                </div>
                
                <AnimatePresence>
                  {!isAiOptionsCollapsed && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        {[
                          { key: 'scan', label: 'Scanning & Extraction', icon: <LayoutGrid className="w-4 h-4" /> },
                          { key: 'compare', label: 'Comparison & Reports', icon: <GitCompare className="w-4 h-4" /> },
                          { key: 'accuracy', label: 'Accuracy Checks', icon: <CheckCircle2 className="w-4 h-4" /> },
                          { key: 'chat', label: 'AI Chat', icon: <MessageSquare className="w-4 h-4" /> }
                        ].map((section) => (
                          <div key={section.key} className="space-y-4 p-6 bg-white/5 rounded-2xl border border-white/10">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="p-2 rounded-lg bg-[var(--amber-dim)] text-[var(--amber)]">
                                {section.icon}
                              </div>
                              <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text)]">{section.label}</h4>
                            </div>
                            
                            <div className="space-y-2">
                              {availableModels.map((model) => (
                                <button
                                  key={model.id}
                                  onClick={() => setModelConfig(prev => ({ ...prev, [section.key]: model.id }))}
                                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                                    modelConfig[section.key as keyof typeof modelConfig] === model.id 
                                      ? 'bg-[var(--amber-dim)] border-[var(--amber)]/50' 
                                      : 'bg-black/20 border-white/5 hover:border-white/20'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[10px] font-bold ${modelConfig[section.key as keyof typeof modelConfig] === model.id ? 'text-[var(--amber)]' : 'text-[var(--text)]'}`}>
                                      {model.name}
                                    </span>
                                    {modelConfig[section.key as keyof typeof modelConfig] === model.id && (
                                      <CheckCircle2 className="w-3 h-3 text-[var(--amber)]" />
                                    )}
                                  </div>
                                  <p className="text-[8px] text-[var(--muted)] leading-relaxed">{model.desc}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className={`pt-12 border-t border-[var(--border)] ${isAiOptionsCollapsed ? 'mt-0' : 'mt-12'}`}>
                  <h3 className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase flex items-center gap-3 font-bold mb-8">
                    <BarChart3 className="w-4 h-4 text-[var(--cyan)]" /> Gemini Usage Tracking
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {availableModels.map(model => {
                      const modelUsage = usage[model.id] || { requests: 0, tokens: 0 };
                      const maxTokens = model.id.includes('pro') ? 1000000 : 2000000; // Estimated limits for visualization
                      const percentage = Math.min(100, (modelUsage.tokens / maxTokens) * 100);
                      const remainingMessages = manualQuota[model.id];
                      
                      return (
                        <div key={model.id} className="glass rounded-2xl p-6 border border-white/5 bg-black/20">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="text-[10px] font-bold text-[var(--text)] uppercase tracking-widest mb-1">{model.name}</div>
                              <div className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">{modelUsage.requests} Requests Made</div>
                            </div>
                            <div className="text-right">
                              {remainingMessages !== undefined ? (
                                <div className="flex flex-col items-end">
                                  <div className={`text-[10px] font-mono font-bold ${remainingMessages < 5 ? 'text-[var(--red)]' : 'text-[var(--cyan)]'}`}>
                                    {remainingMessages} LEFT
                                  </div>
                                  <button 
                                    onClick={() => {
                                      const val = prompt(`Enter remaining messages for ${model.name} from AI Studio:`, remainingMessages.toString());
                                      if (val !== null) {
                                        const num = parseInt(val);
                                        if (!isNaN(num)) {
                                          setManualQuota(prev => {
                                            const next = { ...prev, [model.id]: num };
                                            set('manual_quota', next);
                                            return next;
                                          });
                                        }
                                      }
                                    }}
                                    className="text-[7px] text-[var(--muted)] hover:text-[var(--amber)] uppercase tracking-widest mt-1"
                                  >
                                    Sync Quota
                                  </button>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => {
                                    const val = prompt(`Enter remaining messages for ${model.name} from AI Studio:`, "15");
                                    if (val !== null) {
                                      const num = parseInt(val);
                                      if (!isNaN(num)) {
                                        setManualQuota(prev => {
                                          const next = { ...prev, [model.id]: num };
                                          set('manual_quota', next);
                                          return next;
                                        });
                                      }
                                    }
                                  }}
                                  className="text-[8px] text-[var(--amber)] border border-[var(--amber)]/30 px-2 py-1 rounded hover:bg-[var(--amber-dim)] uppercase tracking-widest"
                                >
                                  Track Real Quota
                                </button>
                              )}
                            </div>
                          </div>
                          
                          <div className="relative h-2 bg-[var(--bg)] rounded-full overflow-hidden border border-white/5">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${percentage}%` }}
                              className={`h-full rounded-full ${percentage > 80 ? 'bg-[var(--red)]' : percentage > 50 ? 'bg-[var(--amber)]' : 'bg-[var(--cyan)]'}`}
                            />
                          </div>
                          <div className="flex justify-between mt-2">
                            <div className="flex flex-col">
                              <span className="text-[7px] text-[var(--muted)] uppercase tracking-widest">Tokens: {modelUsage.tokens.toLocaleString()}</span>
                            </div>
                            <span className="text-[7px] text-[var(--muted)] uppercase tracking-widest">Est. Limit: {maxTokens.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 p-6 bg-[var(--amber-dim)] border border-[var(--amber)]/30 rounded-2xl">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 rounded-full bg-[var(--amber)] text-black">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-[var(--amber)]">AI Studio Account</h4>
                        <p className="text-[9px] text-[var(--muted)]">Sync your real usage and quota data from Google AI Studio.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsConnectModalOpen(true)}
                      className="w-full py-4 rounded-xl bg-black/40 border border-[var(--amber)]/30 text-[var(--amber)] text-[10px] font-bold uppercase tracking-[2px] hover:bg-[var(--amber)] hover:text-black transition-all"
                    >
                      Connect AI Studio Account
                    </button>
                  </div>
                  
                  <div className="mt-8 flex justify-center gap-4">
                    <button 
                      onClick={() => {
                        setUsage({});
                        set('gemini_usage', {});
                        setManualQuota({});
                        set('manual_quota', {});
                        showNotification("Usage history cleared", "success");
                      }}
                      className="text-[9px] text-[var(--red)] border border-[var(--red)] px-4 py-2 rounded-xl hover:bg-[var(--red)] hover:text-black transition-all uppercase font-bold tracking-[2px]"
                    >
                      Reset All Stats
                    </button>
                  </div>
                </div>

                <div className="mt-8 p-4 bg-[var(--amber-dim)]/20 border border-[var(--amber)]/20 rounded-2xl">
                  <p className="text-[9px] text-[var(--amber)] leading-relaxed flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    <span>Tip: If you are hitting rate limits, switch to <strong>Gemini 3 Flash</strong> or <strong>Flash Lite</strong> for faster processing and higher quotas.</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-8 animate-in fade-in duration-700">
              <div className="glass rounded-3xl p-8 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase flex items-center gap-3 font-bold">
                    <Brain className="w-4 h-4 text-[var(--amber)]" /> Custom AI Prompt
                  </h3>
                  <button
                    onClick={() => setIsCustomPromptEnabled(!isCustomPromptEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isCustomPromptEnabled ? 'bg-[var(--amber)]' : 'bg-[var(--s2)]'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isCustomPromptEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <input 
                      type="file" 
                      ref={promptFileInputRef} 
                      accept=".txt,.md,.pdf,.doc,.docx" 
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const base64 = await fileToBase64(file);
                            setCustomPromptFileData(base64);
                            setCustomPromptFileName(file.name);
                            setCustomPromptMimeType(file.type || 'text/plain');
                            setIsCustomPromptEnabled(true);
                            showNotification(`File "${file.name}" uploaded`, "success");
                          } catch (err) {
                            showNotification("Failed to process file", "error");
                          }
                        }
                        if (promptFileInputRef.current) promptFileInputRef.current.value = '';
                      }} 
                    />
                    <button 
                      onClick={() => promptFileInputRef.current?.click()}
                      className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--s2)] text-[var(--text)] hover:bg-[var(--s3)] transition-all uppercase font-bold tracking-[2px] text-[10px]"
                    >
                      <Download className="w-4 h-4" /> {customPromptFileName ? 'Change File' : 'Upload Prompt File'}
                    </button>
                    {customPromptFileName && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-[var(--amber-dim)] border border-[var(--amber)] rounded-lg">
                        <FileText className="w-3 h-3 text-[var(--amber)]" />
                        <span className="text-[10px] text-[var(--text)] font-mono truncate max-w-[150px]">{customPromptFileName}</span>
                        <button onClick={() => {
                          setCustomPromptFileData(null);
                          setCustomPromptFileName(null);
                          setCustomPromptMimeType(null);
                        }} className="p-1 hover:bg-white/10 rounded">
                          <X className="w-3 h-3 text-[var(--muted)]" />
                        </button>
                      </div>
                    )}
                    <span className="text-[10px] text-[var(--muted)] uppercase tracking-[1px]">
                      Text, MD, PDF, DOCX
                    </span>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] text-[var(--muted)] uppercase tracking-[2px] font-bold">Prompt Content</label>
                    <textarea
                      value={customPromptText}
                      onChange={(e) => setCustomPromptText(e.target.value)}
                      placeholder="Enter custom instructions or context for the AI here. This will be prepended to all AI requests."
                      className="w-full h-64 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4 text-[12px] text-[var(--text)] font-mono resize-y focus:outline-none focus:border-[var(--amber)] transition-colors custom-scrollbar"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'source' && (
            <SourceCodeView />
          )}

          {activeTab === 'dashboard' && <Dashboard />}

          {activeTab === 'instant' && (
            <div className="space-y-8">
              <input 
                type="file" 
                ref={fileInputRef} 
                accept=".json,.txt" 
                multiple 
                className="hidden" 
                onChange={e => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const filesArray = Array.from(files);
                    handleFiles(filesArray);
                    e.target.value = '';
                  }
                }} 
              />
              <div 
                className="glass rounded-3xl p-16 text-center cursor-pointer transition-all relative mb-4 hover:border-[var(--amber)] hover:bg-[rgba(245,158,11,0.03)] group"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)); }}
              >
                <div className="w-20 h-20 bg-[var(--bg)] border border-[var(--border)] rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform shadow-xl">
                  <Download className="w-8 h-8 text-[var(--amber)]" />
                </div>
                <div className="font-serif text-2xl text-[var(--text)] mb-2 italic">Drop your chat archive here</div>
                <p className="text-[11px] text-[var(--muted)] tracking-[2px] leading-loose uppercase">
                  .json or .txt · multiple files OK<br/>
                  <span className="text-[var(--cyan)]">Instant scoring · Sentiment analysis · Topic detection</span>
                </p>
              </div>

              {/* File History Section */}
              {fileHistory.filter(h => h.type === 'source').length > 0 && (
                <div className="mb-8 bg-[var(--s1)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--s2)]">
                    <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase font-bold flex items-center gap-2">
                      <History className="w-3 h-3 text-[var(--amber)]" /> Recent Source Files
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => loadAllFromHistory('source')}
                        disabled={isProcessingFiles || isHistoryLoading}
                        className="relative text-[8px] tracking-[2px] text-[var(--amber)] border border-[var(--amber)] px-2 py-1 rounded hover:bg-[var(--amber)] hover:text-black transition-all uppercase font-bold overflow-hidden"
                      >
                        <span className="relative z-10">
                          {isProcessingFiles && activeTab === 'instant' ? `Loading... ${Math.round(fileProcessingProgress)}%` : 'Load All as Source'}
                        </span>
                        {isProcessingFiles && activeTab === 'instant' && (
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${fileProcessingProgress}%` }}
                            className="absolute inset-0 bg-[var(--amber)]/20 z-0"
                          />
                        )}
                      </button>
                      <button 
                        onClick={clearAllHistory}
                        className="text-[8px] tracking-[2px] text-[var(--red)] border border-[var(--red)] px-2 py-1 rounded hover:bg-[var(--red)] hover:text-black transition-all uppercase font-bold"
                      >
                        Clear All History
                      </button>
                      <span className="text-[8px] text-[var(--muted)] uppercase tracking-[1px]">{fileHistory.filter(h => h.type === 'source').length} stored</span>
                    </div>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 custom-scrollbar">
                    {fileHistory.filter(h => h.type === 'source').map((h: any) => (
                      <div key={h.key} className="flex items-center gap-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg hover:border-[var(--amber)] transition-all group">
                        <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadFromHistory(h.key)}>
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-[var(--text)] truncate font-bold">{h.name}</div>
                          </div>
                          <div className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">
                            {new Date(h.timestamp).toLocaleDateString()} · {(h.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteFromHistory(h.key); }}
                          className="p-1 hover:bg-[var(--dim)] rounded text-[var(--muted)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entries.length > 0 && (
                <div className="flex justify-center mb-8">
                  <button 
                    onClick={() => {
                      setIsAiLoading(false);
                      setEntries([]);
                      setAiStories([]);
                      setAiRejectedStories([]);
                      setChatHistory([]);
                      showNotification("Scan stopped and archive cleared.", "success");
                    }}
                    className="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all uppercase font-bold tracking-[2px] cursor-pointer shadow-lg shadow-red-900/40 active:scale-95"
                  >
                    <X className="w-4 h-4" />
                    Stop & Clear
                  </button>
                </div>
              )}
              
              {entries.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                  {[
                    { label: 'Kept', value: overallStats.kept, icon: CheckCircle2, color: 'var(--green)' },
                    { label: 'Total', value: overallStats.total, icon: LayoutGrid, color: 'var(--blue)' },
                    { label: 'Avg Score', value: overallStats.avgScore, icon: Brain, color: 'var(--purple)' },
                    { label: 'Words', value: overallStats.words, icon: Clock, color: 'var(--cyan)' },
                    { label: 'People', value: overallStats.people, icon: Users, color: 'var(--amber)' }
                  ].map((stat, idx) => (
                    <motion.div 
                      key={stat.label}
                      initial={{ opacity: 0, y: 20 }} 
                      animate={{ opacity: 1, y: 0 }} 
                      transition={{ delay: idx * 0.1 }} 
                      className="glass-dark border border-white/5 rounded-2xl p-5 shadow-xl group hover:border-white/10 transition-all"
                    >
                      <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase mb-3 flex items-center gap-2 font-bold">
                        <stat.icon className="w-3 h-3" style={{ color: stat.color }} /> {stat.label}
                      </div>
                      <div className="font-serif italic text-4xl text-[var(--text)] leading-none group-hover:text-[var(--amber)] transition-colors">{stat.value}</div>
                    </motion.div>
                  ))}
                </div>
              )}

              {entries.length > 0 && (
                <>
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-5 mb-4">
                    <div className="flex items-center gap-4 mt-4 pt-4">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={removeAI} onChange={e => setRemoveAI(e.target.checked)} className="accent-[var(--amber)]" />
                        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Hide AI Responses</span>
                      </label>
                      <div className="ml-auto flex items-center gap-3">
                        <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest">Min Score</span>
                        <input type="range" min="0" max="100" value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="w-32 accent-[var(--amber)]" />
                        <span className="text-[10px] font-mono text-[var(--amber)] w-6">{minScore}</span>
                      </div>
                    </div>
                  </div>

                  {/* AI Summary Section */}
                  <AnimatePresence>
                    {aiSummary && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-zinc-900/50 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-6 mb-6 relative overflow-hidden shadow-2xl"
                      >
                        <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="text-[10px] tracking-[3px] text-amber-500 uppercase font-bold flex items-center gap-2">
                            <Sparkles className="w-3 h-3" /> Archive Intelligence Summary
                          </h3>
                          <button onClick={() => setAiSummary(null)} className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-[var(--muted)] transition-colors">✕</button>
                        </div>
                        <div className="text-sm leading-relaxed text-white/90 whitespace-pre-wrap font-serif italic">
                          {aiSummary}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex gap-3 mb-6">
                    <div className="flex-1 flex gap-2">
                      <button 
                        onClick={generateSummary}
                        disabled={isSummarizing}
                        className="flex-1 bg-[var(--s1)] border border-[var(--border)] text-[var(--text)] py-3 rounded-xl text-[10px] uppercase font-bold tracking-[2px] flex items-center justify-center gap-2 hover:bg-[var(--s2)] hover:border-[var(--amber)] transition-all disabled:opacity-50"
                      >
                        <Brain className="w-4 h-4 text-[var(--amber)]" />
                        {isSummarizing ? 'Analyzing...' : 'Generate AI Summary'}
                      </button>
                    </div>
                    <button 
                      onClick={() => downloadInstantText(true)}
                      className="bg-[var(--s1)] border border-[var(--border)] text-[var(--text)] px-6 py-3 rounded-xl text-[10px] uppercase font-bold tracking-[2px] flex items-center justify-center gap-2 hover:bg-[var(--s2)] hover:border-[var(--amber)] transition-all"
                    >
                      <Download className="w-4 h-4 text-[var(--cyan)]" />
                      Export .MD
                    </button>
                  </div>

                  {/* Archive Message List */}
                  <div className="bg-[var(--bg)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-inner">
                    <div className="p-4 border-b border-[var(--border)] bg-[var(--s1)] flex flex-col sm:flex-row justify-between items-center gap-4">
                      <div className="flex items-center gap-3">
                        <div className="text-[10px] tracking-[3px] text-[var(--muted)] uppercase font-bold">
                          Archive Feed <span className="text-[var(--amber)] ml-2">({filteredEntries.length} entries)</span>
                        </div>
                        <button 
                          onClick={() => setIsArchiveMinimized(!isArchiveMinimized)}
                          className="p-1 hover:bg-[var(--dim)] rounded transition-colors text-[var(--muted)]"
                        >
                          {isArchiveMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rotate-90" />}
                        </button>
                      </div>
                      {!isArchiveMinimized && (
                        <div className="flex items-center gap-4 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--muted)]" />
                            <input 
                              type="text"
                              placeholder="Search archive..."
                              value={archiveSearch}
                              onChange={(e) => setArchiveSearch(e.target.value)}
                              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl pl-9 pr-12 py-2 text-[10px] font-mono outline-none focus:border-[var(--amber)] transition-all"
                            />
                            {archiveSearch && (
                              <button 
                                onClick={() => setArchiveSearch('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--red)] transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button 
                              onClick={() => {
                                const text = filteredEntries.map(e => e.text).join('\n\n---\n\n');
                                navigator.clipboard.writeText(text);
                                showNotification("Copied all filtered entries", "success");
                              }}
                              className="p-2 rounded-xl bg-[var(--s2)] text-[var(--muted)] hover:text-[var(--cyan)] transition-all border border-[var(--border)]"
                              title="Copy All Filtered"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                            <div className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse shadow-[0_0_8px_var(--green)]"></div>
                            <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold">Live Archive</span>
                          </div>
                        </div>
                      )}
                    </div>
                    {!isArchiveMinimized && (
                      <div className="max-h-[500px] overflow-y-auto custom-scrollbar p-4 space-y-4">
                      {filteredEntries.length === 0 ? (
                        <div className="py-20 text-center text-[var(--muted)] font-mono text-[10px] uppercase tracking-[2px]">
                          No entries match your filters
                        </div>
                      ) : (
                        filteredEntries.map((e, idx) => {
                          const isExpanded = expandedEntries.has(e.uId);
                          return (
                            <motion.div 
                              key={e.uId}
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ 
                                type: "spring",
                                stiffness: 400,
                                damping: 30,
                                mass: 1
                              }}
                              onClick={() => toggleEntryExpand(e.uId)}
                              className={`glass rounded-2xl p-5 border transition-all relative overflow-hidden shadow-md cursor-pointer group ${isExpanded ? 'border-[var(--amber)] ring-1 ring-[var(--amber)]/20 bg-[rgba(245,158,11,0.04)]' : 'hover:border-[var(--amber)]/50 border-[var(--border)]'}`}
                            >
                              <div className="flex items-center gap-3 text-[9px] tracking-[2px] text-[var(--muted)] mb-3 font-bold">
                                <span 
                                  className={`px-2 py-0.5 rounded-lg uppercase ${
                                    e.sentiment === 'positive' ? 'bg-[rgba(16,185,129,0.1)] text-[var(--green)]' :
                                    e.sentiment === 'negative' ? 'bg-[rgba(239,68,68,0.1)] text-[var(--red)]' :
                                    'bg-[rgba(59,130,246,0.1)] text-[var(--blue)]'
                                  }`}
                                >
                                  {e.sentiment}
                                </span>
                                <span 
                                  className="px-2 py-0.5 bg-[var(--dim)] text-[var(--text)] rounded-lg uppercase"
                                >
                                  {e.topic}
                                </span>
                                <span className="ml-auto flex items-center gap-1.5">
                                  <Brain className="w-3 h-3 opacity-60 text-[var(--amber)]" />
                                  <span className="text-[var(--amber)] font-black">{e.score}</span>
                                </span>
                                <div className="flex items-center gap-1 ml-2">
                                  <button 
                                    onClick={(ev) => { 
                                      ev.stopPropagation(); 
                                      navigator.clipboard.writeText(e.text);
                                      showNotification("Copied to clipboard", "success");
                                    }}
                                    className="p-1.5 hover:bg-[var(--dim)] rounded-lg text-[var(--muted)] hover:text-[var(--cyan)] transition-colors opacity-0 group-hover:opacity-100"
                                    title="Copy Text"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={(ev) => { 
                                      ev.stopPropagation(); 
                                      toggleHide(e.uId); 
                                    }}
                                    className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--muted)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
                                    title="Hide from Archive"
                                  >
                                    <EyeOff className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="relative">
                                <motion.div 
                                  layout="position"
                                  className={`text-sm leading-relaxed text-[var(--text)] whitespace-pre-wrap font-medium overflow-hidden ${isExpanded ? 'max-h-[400px] overflow-y-auto custom-scrollbar pr-2' : 'max-h-[60px]'}`}
                                >
                                  {e.text}
                                </motion.div>
                                {!isExpanded && e.text.length > 150 && (
                                  <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--s1)] to-transparent pointer-events-none"></div>
                                )}
                              </div>

                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="overflow-hidden"
                                  >
                                    {e.people.length > 0 && (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {e.people.map(p => (
                                          <span 
                                            key={p} 
                                            className="text-[9px] text-[var(--cyan)] bg-[rgba(6,182,212,0.08)] px-2.5 py-1 rounded-lg border border-[rgba(6,182,212,0.1)] font-bold tracking-wider"
                                          >
                                            @{p}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                                      <span className="text-[8px] text-[var(--muted)] uppercase tracking-widest font-mono">ID: {e.uId.substring(0, 8)} • Source: {e.source}</span>
                                      <button 
                                        onClick={(ev) => { ev.stopPropagation(); toggleEntryExpand(e.uId); }}
                                        className="text-[9px] text-[var(--amber)] uppercase font-bold tracking-widest hover:underline"
                                      >
                                        Collapse
                                      </button>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                              <div className={`absolute left-0 top-0 bottom-0 w-1 bg-[var(--amber)] transition-opacity ${isExpanded ? 'opacity-100' : 'opacity-0'}`}></div>
                            </motion.div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                  {/* EXCLUSION */}
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded p-5 mb-4">
                    <div className="text-[9px] tracking-[3px] text-[var(--red)] uppercase mb-4 flex items-center gap-2">
                      Exclude Keywords
                      <div className="flex-1 h-px bg-[var(--border)]"></div>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input 
                        type="text" 
                        value={exclInput} 
                        onChange={e => setExclInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddExcl(); }}
                        placeholder="Word to block…" 
                        className="flex-1 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] font-mono text-[11px] px-3.5 py-2 rounded-sm outline-none focus:border-[var(--red)] transition-colors"
                      />
                      <button onClick={handleAddExcl} className="bg-transparent text-[var(--red)] border border-[var(--red)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded-sm hover:bg-[var(--red)] hover:text-black transition-colors">
                        + Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {excludedWords.map(w => (
                        <div key={w} className="flex items-center gap-1.5 bg-[rgba(224,85,85,0.08)] border border-[rgba(224,85,85,0.2)] rounded-sm px-2.5 py-1 text-[9px] text-[var(--red)]">
                          <span>{w}</span>
                          <button onClick={() => setExcludedWords(prev => prev.filter(x => x !== w))} className="bg-transparent border-none text-[rgba(224,85,85,0.4)] cursor-pointer text-xs hover:text-[var(--red)] transition-colors">✕</button>
                        </div>
                      ))}
                    </div>
                    {excludedWords.length > 0 && (
                      <button 
                        onClick={() => setExcludedWords([])}
                        className="text-[8px] tracking-[2px] text-[var(--red)] hover:underline uppercase font-bold mt-2"
                      >
                        Clear All Keywords
                      </button>
                    )}
                  </div>

                  {/* MANUAL CLEANUP */}
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded p-5 mb-4">
                    <div className="text-[9px] tracking-[3px] text-[var(--purple)] uppercase mb-4 flex items-center gap-2">
                      Step 1: Manual Filtering & Cleanup
                      <div className="flex-1 h-px bg-[var(--border)]"></div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none" onClick={() => setRemoveShort(!removeShort)}>
                      <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${removeShort ? 'bg-[var(--amber)]' : 'bg-[var(--dim)]'}`}>
                        <div className={`absolute top-[3px] w-3.5 h-3.5 rounded-full transition-all ${removeShort ? 'bg-white left-[19px]' : 'bg-[#666] left-[3px]'}`}></div>
                      </div>
                      <span className="text-[9px] text-[var(--muted)] tracking-[1px]">Remove entries shorter than</span>
                    </label>
                    <input 
                      type="number" 
                      value={minChars} 
                      onChange={e => setMinChars(Number(e.target.value))} 
                      min="10" max="2000"
                      className="w-[70px] bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] font-mono text-[11px] px-2.5 py-1.5 rounded-sm outline-none"
                      onClick={e => e.stopPropagation()}
                    />
                    <span className="text-[9px] text-[var(--muted)] tracking-[1px]">chars</span>
                  </div>
                </div>

                  <div className="flex gap-2 mb-4 items-center flex-wrap bg-[rgba(232,160,32,0.03)] p-4 border border-[rgba(232,160,32,0.1)] rounded">
                    <div className="w-full text-[9px] tracking-[2px] text-[var(--amber)] uppercase mb-2">Step 2: AI Deep Cleaning (Good Measure)</div>
                    <div className="flex gap-2 w-full sm:w-auto items-center">
                      <div className="relative model-dropdown-container">
                        <button 
                          onClick={() => setOpenDropdown(openDropdown === 'scan' ? null : 'scan')}
                          className="bg-[var(--s2)] border border-[var(--border)] text-[var(--muted)] px-3 py-2 rounded hover:text-[var(--text)] flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest"
                        >
                          <Settings className="w-3 h-3" />
                          {availableModels.find(m => m.id === modelConfig.scan)?.name.split(' ')[1] || 'Flash'}
                        </button>
                        <AnimatePresence>
                          {openDropdown === 'scan' && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.95 }}
                              className="absolute bottom-full left-0 mb-2 w-48 glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
                            >
                              {availableModels.map(m => (
                                <button 
                                  key={m.id}
                                  onClick={() => {
                                    setModelConfig(prev => ({ ...prev, scan: m.id }));
                                    setOpenDropdown(null);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-lg text-[9px] font-mono uppercase tracking-widest hover:bg-[var(--s2)] ${modelConfig.scan === m.id ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
                                >
                                  {m.name}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <button onClick={() => runAIExtract()} disabled={isAiLoading} className="bg-[var(--amber)] text-black font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:bg-[var(--amber-g)] disabled:opacity-50 flex items-center gap-2">
                        {isAiLoading ? (
                          <>
                            <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                            Extracting...
                          </>
                        ) : '🧠 Start AI Scan'}
                      </button>
                      <label className="flex items-center gap-2 cursor-pointer select-none ml-4" onClick={() => setIsGuardianEnabled(!isGuardianEnabled)}>
                        <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${isGuardianEnabled ? 'bg-[var(--cyan)]' : 'bg-[var(--dim)]'}`}>
                          <div className={`absolute top-[3px] w-3.5 h-3.5 rounded-full transition-all ${isGuardianEnabled ? 'bg-white left-[19px]' : 'bg-[#666] left-[3px]'}`}></div>
                        </div>
                        <span className="text-[9px] text-[var(--muted)] tracking-[1px] uppercase font-bold">Guardian AI (Double-Check)</span>
                      </label>
                      {isAiLoading && (
                        <>
                          <div className="flex-1 h-1 bg-[var(--dim)] rounded-full overflow-hidden ml-4 max-w-[200px]">
                            <motion.div 
                              className="h-full bg-[var(--amber)]"
                              initial={{ width: 0 }}
                              animate={{ width: `${(aiProcessedSoFar / aiTotalProcessed) * 100}%` }}
                            />
                          </div>
                          <button 
                            onClick={() => {
                              setIsAiLoading(false);
                              isAiLoadingRef.current = false;
                            }}
                            className="text-[8px] text-[var(--red)] border border-[var(--red)] px-2 py-1 rounded hover:bg-[var(--red)] hover:text-black transition-colors uppercase font-bold tracking-[1px] ml-2"
                          >
                            Stop
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                    <span className="text-[9px] text-[var(--muted)]">
                      {filteredEntries.length} entries will be analyzed
                    </span>
                  </div>
                <div className="ml-auto flex gap-2 items-center">
                    <span className="text-[8px] text-[var(--muted)] uppercase tracking-[1px] mr-2">Download Filtered Archive:</span>
                    <button onClick={() => downloadInstantText(false)} className="bg-transparent border border-[var(--border)] text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:text-[var(--text)]">
                      ⬇ .txt
                    </button>
                    <button onClick={() => downloadInstantText(true)} className="bg-transparent border border-[var(--border)] text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:text-[var(--text)]">
                      ⬇ .md
                    </button>
                  </div>
                </div>

                {aiBatches.length > 0 && (
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-[var(--cyan)]"></span>
                        Extraction Progress
                      </div>
                      {aiBatches.some(b => b.status === 'error') && !isAiLoading && (
                        <button 
                          onClick={() => runAIExtract(aiBatches.filter(b => b.status === 'error'))}
                          className="text-[9px] text-[var(--red)] border border-[var(--red)] px-2 py-1 rounded hover:bg-[var(--red)] hover:text-black transition-colors uppercase font-bold tracking-[1px]"
                        >
                          Retry Failed Chunks
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {aiBatches.map(b => (
                        <div 
                          key={b.id} 
                          title={b.status === 'error' ? `Error: ${b.error}` : `Chunk ${b.id + 1}: ${b.status}`}
                          className={`w-3 h-3 rounded-sm transition-colors ${
                            b.status === 'success' ? 'bg-[var(--green)]' :
                            b.status === 'error' ? 'bg-[var(--red)] animate-pulse' :
                            b.status === 'processing' ? 'bg-[var(--amber)] animate-pulse' :
                            'bg-[var(--dim)]'
                          }`}
                        ></div>
                      ))}
                    </div>
                    {isAiLoading && <div className="text-[var(--cyan)] text-[10px] mt-3 animate-pulse">{aiProgress}</div>}
                  </div>
                )}

                  {(aiRejectedStories.length > 0 || isAiLoading) && (
                    <div className="mb-8">
                      <div className="flex items-center gap-3 my-6 text-[9px] tracking-[4px] text-[var(--red)] uppercase">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[var(--border)]"></div>
                        🚫 AI Rejected (Removed from Scan)
                        <div className="flex-1 h-px bg-gradient-to-r from-[var(--border)] to-transparent"></div>
                      </div>
                      
                      <div className="bg-[var(--s1)] border border-[var(--border)] rounded p-6 mb-6 relative overflow-hidden">
                        {isAiLoading && (
                          <div className="absolute top-0 left-0 h-1 bg-[var(--amber)] transition-all duration-300" style={{ width: `${(aiProcessedSoFar / aiTotalProcessed) * 100}%` }}></div>
                        )}
                        <div className="flex justify-between items-center mb-6">
                          <div className="text-[9px] tracking-[3px] text-[var(--amber)] uppercase">Live AI Processing Funnel</div>
                          <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px]">Check "2. AI Stories" for results</div>
                        </div>
                        
                        <div className="flex items-center justify-between text-center divide-x divide-[var(--border)]">
                          <div className="flex-1 px-4">
                            <div className="text-[10px] text-[var(--muted)] uppercase tracking-[1px] mb-1">Started With</div>
                            <div className="font-serif text-4xl text-[var(--text)]">{aiTotalProcessed || filteredEntries.length}</div>
                            <div className="text-[9px] text-[var(--muted)] mt-1">valid entries</div>
                          </div>
                          <div className="flex-1 px-4">
                            <div className="text-[10px] text-[var(--muted)] uppercase tracking-[1px] mb-1">Remaining</div>
                            <div className="font-serif text-4xl text-[var(--cyan)]">{aiTotalProcessed > 0 ? aiTotalProcessed - aiProcessedSoFar : 0}</div>
                            <div className="text-[9px] text-[var(--muted)] mt-1">in queue</div>
                          </div>
                          <div className="flex-1 px-4">
                            <div className="text-[10px] text-[var(--muted)] uppercase tracking-[1px] mb-1">AI Removed</div>
                            <div className="font-serif text-4xl text-[var(--red)]">{aiRejectedStories.length}</div>
                            <div className="text-[9px] text-[var(--muted)] mt-1">low signal</div>
                          </div>
                          <div className="flex-1 px-4">
                            <div className="text-[10px] text-[var(--muted)] uppercase tracking-[1px] mb-1">AI Kept</div>
                            <div className="font-serif text-4xl text-[var(--amber)]">{aiStories.length}</div>
                            <div className="text-[9px] text-[var(--muted)] mt-1">high quality</div>
                          </div>
                        </div>
                      </div>

                      <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-3">
                        {aiRejectedStories.map((e, i) => {
                          const r = e.aiReason || 'Other';
                          const isExpanded = expandedRejected.has(e.uId);
                          return (
                            <div key={i} className="bg-[var(--s1)] border border-[var(--border)] rounded-xl overflow-hidden border-l-4 border-l-[var(--red)] hover:bg-[var(--s2)] transition-all group">
                              <div 
                                className="p-4 cursor-pointer"
                                onClick={() => toggleRejectedExpand(e.uId)}
                              >
                                <div className="flex justify-between items-start mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-[rgba(239,68,68,0.1)] text-[var(--red)] text-[8px] tracking-[1px] uppercase rounded font-bold">{r}</span>
                                    <ChevronRight className={`w-3 h-3 text-[var(--muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                  </div>
                                  <button 
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      setAiStories(prev => [...prev, { text: e.text, one_line: e.text.slice(0, 50) + '...', theme: 'Restored', emotion: 'Unknown', timeframe: 'Unknown', importance: 5 }]);
                                      setAiRejectedStories(prev => prev.filter((_, idx) => idx !== i));
                                    }}
                                    className="px-3 py-1 bg-[var(--green)] text-black rounded-lg text-[8px] font-bold uppercase hover:bg-[var(--green-g)] transition-all shadow-sm"
                                  >
                                    Restore
                                  </button>
                                </div>
                                <div className="text-[11px] leading-relaxed text-[var(--muted)] italic line-clamp-2">{e.text}</div>
                              </div>
                              
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="px-4 pb-4 border-t border-[var(--border)] bg-[rgba(239,68,68,0.02)]"
                                  >
                                    <div className="pt-4 space-y-4">
                                      <div>
                                        <div className="text-[8px] text-[var(--red)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                          <Brain className="w-3 h-3" />
                                          AI Explanation
                                        </div>
                                        <p className="text-[10px] text-[var(--text)] leading-relaxed">
                                          {e.aiDetailedReason || "No detailed explanation provided by AI."}
                                        </p>
                                      </div>
                                      
                                      {e.aiProof && (
                                        <div>
                                          <div className="text-[8px] text-[var(--cyan)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3" />
                                            Evidence / Proof
                                          </div>
                                          <div className="p-2 bg-[var(--s3)] rounded border border-[var(--border)] text-[10px] text-[var(--muted)] italic font-mono leading-relaxed">
                                            "{e.aiProof}"
                                          </div>
                                        </div>
                                      )}

                                      <div>
                                        <div className="text-[8px] text-[var(--muted)] uppercase tracking-[2px] font-bold mb-1">Full Original Message</div>
                                        <div className="text-[10px] text-[var(--muted)] leading-relaxed bg-[var(--bg)] p-3 rounded border border-[var(--border)]">
                                          {e.text}
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {activeTab === 'removed' && (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <div className="font-serif italic text-2xl text-[var(--amber)] mb-2">Archive Exclusions</div>
            <p className="text-[11px] text-[var(--muted)] leading-loose max-w-lg mx-auto">
              Review everything that was removed by manual filters or rejected by the AI during the deep scan.
            </p>
          </div>

          {/* KEYWORD DELETED BOX */}
          {filteredData.removed.filter(e => e.removalReason === 'Keyword').length > 0 && (
            <div className="bg-[var(--s1)] border border-[var(--border)] rounded overflow-hidden mb-8">
              <div className="p-3 border-b border-[var(--border)] flex justify-between items-center bg-[rgba(232,160,32,0.05)]">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]"></span>
                  <span className="text-[9px] tracking-[3px] text-[var(--amber)] uppercase font-bold">Keyword Deleted Messages</span>
                </div>
                <div className="flex items-center gap-4">
                  {selectedKeyword && (
                    <button 
                      onClick={() => setSelectedKeyword(null)}
                      className="text-[8px] text-[var(--amber)] border border-[var(--amber)] px-2 py-0.5 rounded hover:bg-[var(--amber)] hover:text-black transition-all uppercase font-bold"
                    >
                      Clear Filter: {selectedKeyword}
                    </button>
                  )}
                  <span className="text-[8px] text-[var(--amber)] opacity-60 uppercase tracking-[1px]">
                    {filteredData.removed.filter(e => e.removalReason === 'Keyword').length} total keyword removals
                  </span>
                </div>
              </div>
              
              {/* Keyword Filter Bar */}
              <div className="p-4 bg-[var(--bg)] border-b border-[var(--border)] flex flex-wrap gap-2">
                <div className="text-[8px] text-[var(--muted)] uppercase tracking-[2px] w-full mb-1 font-bold">Filter by Keyword:</div>
                {activeKeywords.map(([k, count]) => (
                  <button
                    key={k}
                    onClick={() => setSelectedKeyword(selectedKeyword === k ? null : k)}
                    className={`px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-[1px] transition-all border ${
                      selectedKeyword === k 
                        ? 'bg-[var(--amber)] text-black border-[var(--amber)] shadow-lg shadow-[var(--amber-dim)]' 
                        : 'bg-[var(--s1)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--amber)] hover:text-[var(--amber)]'
                    }`}
                  >
                    {k} <span className="opacity-50 ml-1">({count})</span>
                  </button>
                ))}
              </div>

              <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {removedEntries.filter(e => e.removalReason === 'Keyword').length === 0 ? (
                  <div className="p-12 text-center text-[var(--muted)] text-[10px] tracking-[1px] italic">
                    No messages match the selected keyword filter.
                  </div>
                ) : (
                  removedEntries.filter(e => e.removalReason === 'Keyword').map((e, i) => (
                    <div key={i} className="p-5 border-b border-[var(--border)] last:border-b-0 hover:bg-[rgba(232,160,32,0.02)] relative group">
                      <div className="flex items-center gap-2 text-[9px] tracking-[1px] text-[var(--muted)] mb-3">
                        <span className="px-2 py-0.5 bg-[rgba(232,160,32,0.1)] text-[var(--amber)] text-[8px] tracking-[1px] uppercase rounded font-bold flex items-center gap-1">
                          <span>🚫</span>
                          <span className="flex gap-1">
                            Keyword: {e.matchedKeywords?.map((k, kidx) => (
                              <button 
                                key={kidx} 
                                onClick={(ev) => { ev.stopPropagation(); setSelectedKeyword(k); }}
                                className="hover:underline cursor-pointer"
                              >
                                {k}{kidx < (e.matchedKeywords?.length || 0) - 1 ? ',' : ''}
                              </button>
                            ))}
                          </span>
                        </span>
                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">{e.source}</span>
                        </div>
                      </div>
                      <div className="text-xs leading-loose text-[var(--muted)] italic">
                        {highlightKeywords(e.text, e.matchedKeywords || [])}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* AI REJECTED BOX */}
          {aiRejectedStories.length > 0 && (
            <div className="bg-[var(--s1)] border border-[var(--border)] rounded overflow-hidden">
              <div className="p-3 border-b border-[var(--border)] flex justify-between items-center bg-[rgba(224,85,85,0.03)]">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]"></span>
                  <span className="text-[9px] tracking-[3px] text-[var(--amber)] uppercase font-bold">AI Rejected (Low Signal)</span>
                </div>
                <span className="text-[8px] text-[var(--red)] opacity-60 uppercase tracking-[1px]">{aiRejectedStories.length} entries</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {aiRejectedStories.map((e, i) => {
                  const r = e.aiReason || 'Other';
                  const isExpanded = expandedRejected.has(e.uId);
                  const icons: Record<string, string> = {
                    'Technical': '🛠️',
                    'AI-Talk': '🤖',
                    'Trivial': '🤏',
                    'Greeting': '👋',
                    'Instruction': '📝',
                    'Bot-Freeze': '❄️',
                    'Other': '❓'
                  };
                  const icon = icons[r] || '❓';

                  return (
                    <div key={i} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[rgba(239,68,68,0.01)] transition-colors group">
                      <div 
                        className="p-4 cursor-pointer"
                        onClick={() => toggleRejectedExpand(e.uId)}
                      >
                        <div className="flex items-center gap-2 text-[8px] mb-2 text-[var(--muted)]">
                          <span className="px-1.5 py-0.5 border border-[var(--red)] text-[var(--red)] rounded uppercase font-bold flex items-center gap-1">
                            <span>{icon}</span>
                            <span>{r}</span>
                          </span>
                          <span>{e.charCount} chars</span>
                          <ChevronRight className={`w-3 h-3 text-[var(--muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          <button 
                            onClick={(ev) => {
                              ev.stopPropagation();
                              console.log("Button Click: Restore Rejected Story");
                              setAiStories(prev => [...prev, { text: e.text, one_line: e.text.slice(0, 50) + '...', theme: 'Restored', emotion: 'Unknown', timeframe: 'Unknown', importance: 5 }]);
                              setAiRejectedStories(prev => prev.filter((_, idx) => idx !== i));
                            }}
                            className="ml-2 px-2 py-0.5 bg-[var(--green)] text-black rounded text-[7px] font-bold uppercase opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            Restore
                          </button>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-[var(--muted)]">AI Score:</span>
                            <span className="text-[var(--red)]">{e.score}</span>
                          </div>
                        </div>
                        <div className={`text-[10px] leading-relaxed text-[var(--muted)] ${isExpanded ? '' : 'line-through decoration-[rgba(224,85,85,0.1)] line-clamp-2'}`}>
                          {e.text}
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="px-4 pb-4 bg-[rgba(239,68,68,0.02)]"
                          >
                            <div className="pt-2 space-y-3 border-t border-[var(--border)] mt-1">
                              <div>
                                <div className="text-[8px] text-[var(--red)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                  <Brain className="w-3 h-3" />
                                  AI Detailed Explanation
                                </div>
                                <p className="text-[10px] text-[var(--text)] leading-relaxed">
                                  {e.aiDetailedReason || "No detailed explanation provided."}
                                </p>
                              </div>
                              
                              {e.aiProof && (
                                <div>
                                  <div className="text-[8px] text-[var(--cyan)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Proof of Rejection
                                  </div>
                                  <div className="p-2 bg-[var(--s3)] rounded border border-[var(--border)] text-[9px] text-[var(--muted)] italic font-mono leading-relaxed">
                                    "{e.aiProof}"
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* REMOVED MESSAGES */}
          <div className="bg-[var(--s1)] border border-[var(--border)] rounded overflow-hidden">
            <div className="p-3 border-b border-[var(--border)] flex justify-between items-center bg-[rgba(224,85,85,0.03)]">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]"></span>
                <span className="text-[9px] tracking-[3px] text-[var(--red)] uppercase font-bold">Manually Filtered Messages</span>
              </div>
              <span className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase">{removedEntries.length} entries filtered out</span>
            </div>
            <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
              {removedEntries.length === 0 ? (
                <div className="p-12 text-center text-[var(--muted)] text-[10px] tracking-[1px] italic">
                  No messages have been removed by current filters.
                </div>
              ) : (
                <>
                  {removedEntries.slice(0, 100).map((e, i) => {
                    let reason = 'Filter';
                    let icon = '⚙️';
                    if (e.isHidden) { reason = 'Manual'; icon = '👁️‍🗨️'; }
                    else if (e.isAssistant) { reason = 'AI-Reply'; icon = '🤖'; }
                    else if (removeShort && e.charCount < minChars) { reason = 'Short'; icon = '📏'; }
                    else if (e.score < minScore) { reason = 'Low-Score'; icon = '📉'; }
                    else { reason = 'Keyword'; icon = '🚫'; }

                    return (
                      <div key={i} className="p-5 border-b border-[var(--border)] hover:bg-[rgba(224,85,85,0.02)] relative group">
                        <div className="flex items-center gap-2 text-[9px] tracking-[1px] text-[var(--muted)] mb-3">
                          <span className="px-2 py-0.5 bg-[rgba(224,85,85,0.1)] text-[var(--red)] text-[8px] tracking-[1px] uppercase rounded font-bold flex items-center gap-1">
                            <span>{icon}</span>
                            <span>{reason}</span>
                          </span>
                          {e.removalReason === 'Keyword' && e.matchedKeywords && (
                            <span className="text-[var(--amber)] opacity-80 font-bold flex gap-1">
                              [
                              {e.matchedKeywords.map((k, kidx) => (
                                <button 
                                  key={kidx} 
                                  onClick={(ev) => { ev.stopPropagation(); setSelectedKeyword(k); }}
                                  className="hover:underline cursor-pointer"
                                >
                                  {k}{kidx < (e.matchedKeywords?.length || 0) - 1 ? ',' : ''}
                                </button>
                              ))}
                              ]
                            </span>
                          )}
                          {e.score < minScore && <span className="text-[var(--red)] opacity-60">Score {e.score}</span>}
                          {removeShort && e.charCount < minChars && <span className="text-[var(--red)] opacity-60">{e.charCount}c</span>}
                          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">{e.source}</span>
                          </div>
                        </div>
                        <div className="text-xs leading-loose text-[var(--muted)] whitespace-pre-wrap italic line-through decoration-[rgba(224,85,85,0.2)] opacity-50">{e.text}</div>
                      </div>
                    );
                  })}
                  {removedEntries.length > 100 && (
                    <div className="p-4 text-center text-[var(--muted)] text-[9px] tracking-[1px] uppercase border-t border-[var(--border)] bg-[var(--bg)]">
                      + {removedEntries.length - 100} more removed entries hidden
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'analysis' && (
        <div className="space-y-12 animate-in">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/5 pb-12">
            <div className="max-w-xl">
              <h2 className="font-serif italic text-5xl text-[var(--text)] mb-4 leading-tight">Life Curations</h2>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed uppercase tracking-[1px]">
                Deeply extracted personal narratives and meaningful memories identified by the AI engine.
              </p>
            </div>
            {aiStories.length > 0 && (
              <button 
                onClick={() => downloadAIText(true)}
                className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono font-bold tracking-[2px] uppercase hover:bg-white/10 transition-all flex items-center gap-3"
              >
                <Download className="w-4 h-4" /> Export Archive
              </button>
            )}
          </div>

          {aiStories.length === 0 && !isAiLoading && (
            <div className="glass-dark rounded-3xl p-24 text-center border border-white/5">
              <Sparkles className="w-16 h-16 text-white/5 mx-auto mb-6" />
              <p className="text-[var(--muted)] text-[11px] uppercase tracking-[4px] font-bold">No narratives identified</p>
              <p className="text-[10px] text-[var(--muted)] mt-2 opacity-50">Run the neural scan to begin extraction</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-12">
            {aiStories.map((s, i) => {
              const isExpanded = expandedStories.has(i);
              return (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => toggleStoryExpand(i)}
                  className="group cursor-pointer"
                >
                  <div className="flex flex-col md:flex-row gap-8">
                    <div className="md:w-1/4">
                      <div className="text-[10px] font-mono text-[var(--amber)] font-bold tracking-[4px] uppercase mb-3">0{i+1} / {s.theme}</div>
                      <div className="flex items-center gap-3 text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold">
                        <span className="flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-[var(--amber)]" /> {s.emotion}</span>
                        <span className="w-1 h-1 rounded-full bg-white/10"></span>
                        <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> {s.timeframe}</span>
                      </div>
                    </div>
                    <div className="md:w-3/4">
                      <h3 className="font-serif text-3xl text-[var(--text)] italic leading-tight mb-6 group-hover:text-[var(--amber)] transition-colors">{s.one_line}</h3>
                      <div className={`text-[15px] leading-relaxed text-[var(--muted)] font-medium border-l-2 border-white/5 pl-8 mb-6 transition-all duration-500 ${isExpanded ? '' : 'line-clamp-2'}`}>
                        "{s.text}"
                      </div>
                      
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="flex items-center gap-6 mb-8">
                              <div className="flex flex-col">
                                <span className="text-[9px] text-[var(--muted)] uppercase tracking-widest font-bold mb-1">Importance</span>
                                <div className="flex gap-1">
                                  {[...Array(10)].map((_, idx) => (
                                    <div key={idx} className={`w-3 h-1 rounded-full ${idx < s.importance ? 'bg-[var(--amber)]' : 'bg-white/5'}`}></div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {s.sources && s.sources.length > 0 && (
                              <div className="pt-8 border-t border-white/5">
                                <p className="text-[10px] font-mono uppercase tracking-[3px] text-[var(--muted)] mb-4">Neural Grounding Sources</p>
                                <div className="flex flex-wrap gap-3">
                                  {s.sources.map((url: string, idx: number) => (
                                    <a 
                                      key={idx} 
                                      href={url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-[10px] font-mono bg-white/5 px-4 py-2 rounded-xl border border-white/5 text-[var(--cyan)] hover:bg-[var(--cyan)] hover:text-black transition-all"
                                    >
                                      {new URL(url).hostname}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'compare' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="text-center mb-8">
            <div className="font-serif italic text-3xl text-[var(--amber)] mb-2">Archive Comparison</div>
            <p className="text-[11px] text-[var(--muted)] leading-loose max-w-lg mx-auto uppercase tracking-[2px]">
              Upload a new file to check for missing life information against your current archive.
            </p>
          </div>

          <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-8 text-center">
              <div className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold mb-4">1. Source of Truth</div>
              <p className="text-[10px] text-[var(--muted)] mb-6">Using your currently filtered archive as the raw source.</p>
              <div className="font-serif text-4xl text-[var(--cyan)] mb-2">{filteredEntries.length}</div>
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-[2px] mb-8">Active Entries</div>

              <div className="text-[10px] tracking-[3px] text-[var(--amber)] uppercase font-bold mb-4">2. Document to Check</div>
              <p className="text-[10px] text-[var(--muted)] mb-6">Upload a new file to check for missing life information.</p>
            <input 
              type="file" 
              id="compare-upload" 
              accept=".json,.txt"
              className="hidden" 
              onChange={e => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  const filesArray = Array.from(files);
                  handleComparisonFiles(filesArray);
                  e.target.value = '';
                }
              }} 
            />
            <label 
              htmlFor="compare-upload"
              className="inline-flex flex-col items-center justify-center cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center mb-4 group-hover:border-[var(--amber)] transition-all">
                <GitCompare className="w-8 h-8 text-[var(--muted)] group-hover:text-[var(--amber)]" />
              </div>
              <div className="text-sm text-[var(--text)] font-serif italic mb-1">Select file to compare</div>
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-[1px]">.json or .txt</div>
            </label>

            {/* Comparison History */}
            {fileHistory.filter(h => h.type === 'compare').length > 0 && (
              <div className="mt-8 pt-8 border-t border-[var(--border)] text-left">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase font-bold flex items-center gap-2">
                    <History className="w-3 h-3 text-[var(--cyan)]" /> Recent Comparison Files
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={clearAllHistory}
                      className="text-[8px] tracking-[2px] text-[var(--red)] border border-[var(--red)] px-2 py-1 rounded hover:bg-[var(--red)] hover:text-black transition-all uppercase font-bold"
                    >
                      Clear All History
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {fileHistory.filter(h => h.type === 'compare').map((h: any) => (
                    <div key={h.key} className="flex items-center gap-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg hover:border-[var(--cyan)] transition-all group">
                      <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadFromHistory(h.key)}>
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-[var(--text)] truncate font-bold">{h.name}</div>
                        </div>
                        <div className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">
                          {new Date(h.timestamp).toLocaleDateString()} · {(h.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteFromHistory(h.key); }}
                        className="p-1 hover:bg-[var(--dim)] rounded text-[var(--muted)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {comparisonEntries.length > 0 && (
              <div className="mt-8 pt-8 border-t border-[var(--border)]">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <div className="text-left">
                    <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px]">New Data</div>
                    <div className="text-xl font-serif text-[var(--amber)]">{comparisonEntries.length} entries</div>
                  </div>
                  <div className="w-px h-8 bg-[var(--border)]"></div>
                  <div className="text-left">
                    <div className="text-[8px] text-[var(--muted)] uppercase tracking-[1px]">Source Archive</div>
                    <div className="text-xl font-serif text-[var(--cyan)]">{filteredEntries.length} entries</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <div className="relative model-dropdown-container w-full sm:w-auto">
                    <button 
                      onClick={() => setOpenDropdown(openDropdown === 'compare' ? null : 'compare')}
                      className="w-full sm:w-auto bg-[var(--s2)] border border-[var(--border)] text-[var(--muted)] px-6 py-3 rounded-full hover:text-[var(--text)] flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-widest"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {availableModels.find(m => m.id === modelConfig.compare)?.name || 'Select Model'}
                    </button>
                    <AnimatePresence>
                      {openDropdown === 'compare' && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute bottom-full left-0 mb-2 w-full sm:w-64 glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
                        >
                          {availableModels.map(m => (
                            <button 
                              key={m.id}
                              onClick={() => {
                                setModelConfig(prev => ({ ...prev, compare: m.id }));
                                setOpenDropdown(null);
                              }}
                              className={`w-full text-left px-4 py-3 rounded-lg text-[10px] font-mono uppercase tracking-widest hover:bg-[var(--s2)] ${modelConfig.compare === m.id ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
                            >
                              {m.name}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <button 
                      onClick={() => runComparison(false)}
                      disabled={isComparing}
                      className="flex-1 bg-[var(--cyan)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--cyan-g)] disabled:opacity-50 transition-all shadow-lg shadow-[var(--cyan-dim)] flex items-center justify-center gap-2"
                    >
                      {isComparing && !comparisonResults ? (
                        <>
                          <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                          Scanning...
                        </>
                      ) : '🔍 Run Comparison'}
                    </button>
                    {(comparisonResults || accResults) && (
                      <button 
                        onClick={generateClaudeSynthesis}
                        disabled={isSynthesizing}
                        className="flex-1 bg-[var(--amber)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--amber-g)] disabled:opacity-50 transition-all shadow-lg shadow-[var(--amber-dim)] flex items-center justify-center gap-2"
                      >
                        {isSynthesizing ? (
                          <>
                            <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                            Synthesizing...
                          </>
                        ) : '🧠 Prepare for Claude'}
                      </button>
                    )}
                  </div>

                  {comparisonResults && (
                    <button 
                      onClick={() => runComparison(true)}
                      disabled={isComparing}
                      className="w-full sm:w-auto bg-transparent border border-[var(--amber)] text-[var(--amber)] font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--amber-dim)] disabled:opacity-50 transition-all"
                    >
                      {isComparing ? 'Deep Scanning...' : '🔬 Rescan for More Nuances'}
                    </button>
                  )}
                </div>

                {comparisonLiveLog.length > 0 && (
                  <div className="mt-6 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
                    <div className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase mb-3 flex items-center gap-2">
                      <MessageSquare className="w-3 h-3 text-[var(--amber)]" /> Live Scan Updates
                    </div>
                    <div className="space-y-1">
                      {comparisonLiveLog.map((log, i) => (
                        <div key={i} className={`text-[10px] font-mono ${i === 0 ? 'text-[var(--amber)]' : 'text-[var(--muted)]'}`}>
                          {i === 0 ? '►' : '•'} {log}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {comparisonThoughts.length > 0 && (
                  <div className="mt-8 bg-[var(--s1)] border border-[var(--border)] rounded-xl p-6 text-left">
                    <h4 className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold mb-4 flex items-center gap-2">
                      <Brain className="w-3 h-3" /> AI Thought Process & Reasoning
                    </h4>
                    <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                      {comparisonThoughts.map((thought, idx) => (
                        <div key={idx} className="text-[11px] leading-relaxed text-[var(--muted)] italic border-l border-[var(--dim)] pl-4">
                          {thought}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {comparisonBatches.length > 0 && (
                  <div className="mt-6 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-[var(--cyan)]"></span>
                        Comparison Progress (Scanning Archive Chunks)
                      </div>
                      {isComparing && comparisonThoughts.length > 0 && (
                        <div className="text-[9px] text-[var(--cyan)] italic animate-pulse">
                          Live Reasoning: {comparisonThoughts[comparisonThoughts.length - 1].substring(0, 60)}...
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {comparisonBatches.map(b => (
                        <div 
                          key={b.id} 
                          className={`w-3 h-3 rounded-sm transition-colors ${
                            b.status === 'success' ? 'bg-[var(--green)]' :
                            b.status === 'error' ? 'bg-[var(--red)] animate-pulse' :
                            b.status === 'processing' ? 'bg-[var(--amber)] animate-pulse' :
                            'bg-[var(--dim)]'
                          }`}
                        ></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {claudeSynthesis && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-12 bg-black/40 border border-[var(--amber)]/30 rounded-3xl p-10 relative overflow-hidden shadow-2xl"
            >
              <div className="absolute top-0 right-0 p-4">
                <div className="bg-[var(--amber)] text-black text-[8px] font-bold px-2 py-1 rounded uppercase tracking-[2px]">Claude Optimized</div>
              </div>
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-[var(--amber)]/10 rounded-2xl flex items-center justify-center border border-[var(--amber)]/20">
                  <Brain className="w-6 h-6 text-[var(--amber)]" />
                </div>
                <div>
                  <h3 className="text-[12px] tracking-[4px] text-[var(--amber)] uppercase font-bold">Claude Master Edit Prompt</h3>
                  <p className="text-[10px] text-[var(--muted)] uppercase tracking-[1px]">Synthesized from Gap Analysis & Accuracy Report</p>
                </div>
              </div>
              <div className="bg-white/5 p-8 rounded-2xl border border-white/10 font-mono text-[12px] leading-relaxed text-[var(--text)] whitespace-pre-wrap select-all cursor-copy hover:border-[var(--amber)]/30 transition-all group relative">
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] uppercase tracking-widest text-[var(--muted)]">Click to copy</div>
                {claudeSynthesis}
              </div>
              <div className="mt-8 flex justify-center">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(claudeSynthesis);
                    showNotification("Copied to clipboard!", "success");
                  }}
                  className="bg-[var(--amber)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-10 py-4 rounded-full hover:bg-[var(--amber-g)] transition-all shadow-xl shadow-[var(--amber-dim)]"
                >
                  Copy Master Prompt
                </button>
              </div>
            </motion.div>
          )}

          {comparisonResults && (
            <div className="space-y-6">
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => downloadComparisonReport(false)}
                  className="bg-transparent border border-[var(--border)] text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:text-[var(--text)]"
                >
                  ⬇ .txt
                </button>
                <button 
                  onClick={() => downloadComparisonReport(true)}
                  className="bg-transparent border border-[var(--border)] text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:text-[var(--text)]"
                >
                  ⬇ .md
                </button>
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-8 relative overflow-hidden shadow-2xl"
              >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-[var(--cyan)]"></div>
                <h3 className="text-[11px] tracking-[4px] text-[var(--cyan)] uppercase font-bold mb-8 flex items-center gap-3">
                  <Sparkles className="w-4 h-4" /> Comprehensive Gap Analysis Report
                </h3>
                <div className="text-lg sm:text-xl leading-relaxed text-[var(--text)] whitespace-pre-wrap font-serif italic prose prose-invert max-w-none bg-[rgba(44,200,168,0.02)] p-8 rounded-lg border border-[rgba(44,200,168,0.1)]">
                  {comparisonResults}
                </div>
              </motion.div>
            </div>
          )}

          {comparisonFindings.length > 0 && (
            <div className="space-y-8">
              {/* AI ANALYSIS & EXPLANATIONS */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div className="text-[9px] tracking-[3px] text-[var(--amber)] uppercase flex items-center gap-2 flex-1">
                    AI Insight: Why these stories are missing
                    <div className="flex-1 h-px bg-[var(--border)]"></div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-center">
                    <div className="text-[8px] tracking-[2px] text-[var(--muted)] uppercase mb-1">Total Gaps Found</div>
                    <div className="font-serif text-2xl text-[var(--amber)]">{comparisonFindings.length}</div>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-center">
                    <div className="text-[8px] tracking-[2px] text-[var(--muted)] uppercase mb-1">Archive Coverage</div>
                    <div className="font-serif text-2xl text-[var(--cyan)]">
                      {filteredEntries.length > 0 ? Math.round(((filteredEntries.length - comparisonFindings.length) / filteredEntries.length) * 100) : 0}%
                    </div>
                  </div>
                  <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-center">
                    <div className="text-[8px] tracking-[2px] text-[var(--muted)] uppercase mb-1">Deep Scan Status</div>
                    <div className="text-[10px] text-[var(--text)] font-mono uppercase tracking-[1px]">
                      {isComparing ? 'Scanning...' : 'Idle'}
                    </div>
                  </div>
                </div>

                <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="max-h-[600px] overflow-y-auto p-6 space-y-12 custom-scrollbar bg-[var(--bg)]">
                    {comparisonFindings.map((f, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative group"
                      >
                        {/* Minimalist Header */}
                        <div className="flex items-center gap-4 mb-10">
                          <div className="text-[10px] font-bold text-[var(--amber)] tracking-[3px] uppercase">
                            Gap {idx + 1}
                          </div>
                          <div className="h-px flex-1 bg-[var(--border)] opacity-30"></div>
                        </div>

                        {/* Editorial Style Explanation */}
                        <div className="max-w-4xl mx-auto space-y-10">
                          <div className="space-y-6">
                            <h3 className="text-2xl sm:text-3xl font-serif text-[var(--text)] leading-tight italic">
                              {f.reason}
                            </h3>
                            <div className="text-sm sm:text-base text-[var(--muted)] leading-relaxed font-sans max-w-3xl border-l border-[var(--border)] pl-6">
                              <span className="text-[10px] text-[var(--amber)] uppercase tracking-[2px] block mb-2 font-bold opacity-70">Contextual Importance</span>
                              {f.importanceReason}
                            </div>
                          </div>

                          {/* Side-by-Side Quotes (Minimalist) */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 pt-10 border-t border-[var(--border)]">
                            {/* Source Quote */}
                            <div className="space-y-6">
                              <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase font-bold opacity-50">
                                Source Archive (Full Message)
                              </div>
                              <div className="text-base sm:text-lg leading-relaxed text-[var(--text)] font-serif italic">
                                "{renderHighlightedText(f.entry.text, f.sourceHighlight, 'bg-[var(--amber)]')}"
                              </div>
                            </div>

                            {/* New File Quote */}
                            <div className="space-y-6">
                              <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase font-bold opacity-50">
                                Related Context in New File
                              </div>
                              {f.newFileFullMessage ? (
                                <>
                                  <div className="text-base sm:text-lg leading-relaxed text-[var(--text)] font-serif italic">
                                    "{renderHighlightedText(f.newFileFullMessage, f.newFileQuote, 'bg-[var(--cyan)]')}"
                                  </div>
                                  <div className="text-xs text-[var(--muted)] leading-relaxed bg-[var(--s1)] p-4 rounded-lg border border-[var(--border)]">
                                    <span className="text-[9px] text-[var(--cyan)] uppercase tracking-[2px] block mb-2 font-bold">Nuance Connection</span>
                                    {f.connectionReason}
                                  </div>
                                </>
                              ) : (
                                <div className="h-full flex items-center justify-center py-10 border border-dashed border-[var(--border)] rounded-xl opacity-50">
                                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-[3px] italic">Entirely Absent</div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Separator for next item */}
                        {idx < comparisonFindings.length - 1 && (
                          <div className="mt-16 flex justify-center">
                            <div className="w-1 h-1 rounded-full bg-[var(--border)] mx-1"></div>
                            <div className="w-1 h-1 rounded-full bg-[var(--border)] mx-1"></div>
                            <div className="w-1 h-1 rounded-full bg-[var(--border)] mx-1"></div>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'accuracy' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="text-center mb-8">
            <div className="font-serif italic text-3xl text-[var(--amber)] mb-2">Accuracy Checker</div>
            <p className="text-[11px] text-[var(--muted)] leading-loose max-w-lg mx-auto uppercase tracking-[2px]">
              Compare AI-written life story against raw source files for hallucinations and distortions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-8 text-center flex flex-col justify-center">
              <div className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold mb-4">1. Source of Truth</div>
              <p className="text-[10px] text-[var(--muted)] mb-6">Using your currently filtered archive as the raw source.</p>
              <div className="font-serif text-4xl text-[var(--cyan)] mb-2">{filteredEntries.length}</div>
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-[2px]">Active Entries</div>
            </div>

            <div className="bg-[var(--s1)] border border-[var(--border)] rounded-xl p-8 text-center">
              <div className="text-[10px] tracking-[3px] text-[var(--amber)] uppercase font-bold mb-4">2. Document v111</div>
              <p className="text-[10px] text-[var(--muted)] mb-6">Upload the AI-written life story to check.</p>
              
              <input 
                type="file" 
                id="acc-doc-upload" 
                accept=".json,.txt"
                className="hidden" 
                onChange={e => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const file = files[0];
                    handleAccuracyFile(file);
                    e.target.value = '';
                  }
                }} 
              />
              <label 
                htmlFor="acc-doc-upload"
                className="inline-flex flex-col items-center justify-center cursor-pointer group"
              >
                <div className="w-16 h-16 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center mb-4 group-hover:border-[var(--amber)] transition-all">
                  <FileText className="w-8 h-8 text-[var(--muted)] group-hover:text-[var(--amber)]" />
                </div>
                <div className="text-sm text-[var(--text)] font-serif italic mb-1">
                  {accDocFile ? accDocFile.name : 'Select Document'}
                </div>
              </label>

              {/* Accuracy History */}
              {fileHistory.filter(h => h.type === 'accuracy').length > 0 && (
                <div className="mt-8 pt-8 border-t border-[var(--border)] text-left">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-[9px] tracking-[3px] text-[var(--muted)] uppercase font-bold flex items-center gap-2">
                      <History className="w-3 h-3 text-[var(--cyan)]" /> Recent Accuracy Documents
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fileHistory.filter(h => h.type === 'accuracy').map((h: any) => (
                      <div key={h.key} className="flex items-center gap-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg hover:border-[var(--cyan)] transition-all group">
                        <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadFromHistory(h.key)}>
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] text-[var(--text)] truncate font-bold">{h.name}</div>
                          </div>
                          <div className="text-[8px] text-[var(--muted)] uppercase tracking-tighter">
                            {new Date(h.timestamp).toLocaleDateString()} · {(h.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteFromHistory(h.key); }}
                          className="p-1 hover:bg-[var(--dim)] rounded text-[var(--muted)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {accDocFile && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <div className="flex flex-col gap-2 w-full sm:w-auto">
                <div className="relative model-dropdown-container w-full">
                  <button 
                    onClick={() => setOpenDropdown(openDropdown === 'accuracy' ? null : 'accuracy')}
                    className="w-full bg-[var(--s2)] border border-[var(--border)] text-[var(--muted)] px-6 py-3 rounded-full hover:text-[var(--text)] flex items-center justify-center gap-2 text-[10px] font-mono uppercase tracking-widest"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    {availableModels.find(m => m.id === modelConfig.accuracy)?.name || 'Select Model'}
                  </button>
                  <AnimatePresence>
                    {openDropdown === 'accuracy' && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute bottom-full left-0 mb-2 w-full glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
                      >
                        {availableModels.map(m => (
                          <button 
                            key={m.id}
                            onClick={() => {
                              setModelConfig(prev => ({ ...prev, accuracy: m.id }));
                              setOpenDropdown(null);
                            }}
                            className={`w-full text-left px-4 py-3 rounded-lg text-[10px] font-mono uppercase tracking-widest hover:bg-[var(--s2)] ${modelConfig.accuracy === m.id ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button 
                    onClick={() => runAccuracyCheck(false)}
                    disabled={isAccChecking}
                    className="flex-1 bg-[var(--amber)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--amber-g)] disabled:opacity-50 transition-all shadow-lg shadow-[var(--amber-dim)] flex items-center justify-center gap-2"
                  >
                    {isAccChecking && !accResults ? (
                      <>
                        <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                        Checking Accuracy...
                      </>
                    ) : '🔍 Run Accuracy Check'}
                  </button>
                  {(comparisonResults || accResults) && (
                    <button 
                      onClick={generateClaudeSynthesis}
                      disabled={isSynthesizing}
                      className="flex-1 bg-[var(--cyan)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--cyan-g)] disabled:opacity-50 transition-all shadow-lg shadow-[var(--cyan-dim)] flex items-center justify-center gap-2"
                    >
                      {isSynthesizing ? (
                        <>
                          <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                          Synthesizing...
                        </>
                      ) : '🧠 Prepare for Claude'}
                    </button>
                  )}
                </div>
                {isAccChecking && (
                  <>
                    <div className="h-1 bg-[var(--dim)] rounded-full overflow-hidden w-full">
                      <motion.div 
                        className="h-full bg-[var(--cyan)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(accBatches.filter(b => b.status === 'success').length / accBatches.length) * 100 || 0}%` }}
                      />
                    </div>
                    <button 
                      onClick={() => {
                        setIsAccChecking(false);
                        isAccCheckingRef.current = false;
                      }}
                      className="text-[8px] text-[var(--red)] border border-[var(--red)] px-2 py-1 rounded hover:bg-[var(--red)] hover:text-black transition-colors uppercase font-bold tracking-[1px]"
                    >
                      Stop
                    </button>
                  </>
                )}
              </div>

              {accResults && (
                <button 
                  onClick={() => runAccuracyCheck(true)}
                  disabled={isAccChecking}
                  className="w-full sm:w-auto bg-transparent border border-[var(--amber)] text-[var(--amber)] font-mono text-[10px] font-bold tracking-[2px] uppercase px-8 py-3 rounded-full hover:bg-[var(--amber-dim)] disabled:opacity-50 transition-all"
                >
                  {isAccChecking ? 'Deep Scanning...' : '🔬 Rescan for More Nuances'}
                </button>
              )}
            </div>
          )}

          {accLiveLog.length > 0 && (
            <div className="mt-6 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
              <div className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase mb-3 flex items-center gap-2">
                <MessageSquare className="w-3 h-3 text-[var(--amber)]" /> Live Scan Updates
              </div>
              <div className="space-y-1">
                {accLiveLog.map((log, i) => (
                  <div key={i} className={`text-[10px] font-mono ${i === 0 ? 'text-[var(--amber)]' : 'text-[var(--muted)]'}`}>
                    {i === 0 ? '►' : '•'} {log}
                  </div>
                ))}
              </div>
            </div>
          )}

          {accThoughts.length > 0 && (
            <div className="mt-8 bg-[var(--s1)] border border-[var(--border)] rounded-xl p-6 text-left">
              <h4 className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold mb-4 flex items-center gap-2">
                <Brain className="w-3 h-3" /> AI Thought Process & Reasoning
              </h4>
              <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                {accThoughts.map((thought, idx) => (
                  <div key={idx} className="text-[11px] leading-relaxed text-[var(--muted)] italic border-l border-[var(--dim)] pl-4">
                    {thought}
                  </div>
                ))}
              </div>
            </div>
          )}

          {accBatches.length > 0 && (
            <div className="mt-6 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[9px] tracking-[2px] text-[var(--muted)] uppercase flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-[var(--cyan)]"></span>
                  Accuracy Progress (Scanning Archive Chunks)
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {accBatches.map(b => (
                  <div 
                    key={b.id} 
                    className={`w-3 h-3 rounded-sm transition-colors ${
                      b.status === 'success' ? 'bg-[var(--green)]' :
                      b.status === 'error' ? 'bg-[var(--red)] animate-pulse' :
                      b.status === 'processing' ? 'bg-[var(--amber)] animate-pulse' :
                      'bg-[var(--dim)]'
                    }`}
                  ></div>
                ))}
              </div>
            </div>
          )}

          {claudeSynthesis && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-12 bg-black/40 border border-[var(--amber)]/30 rounded-3xl p-10 relative overflow-hidden shadow-2xl"
            >
              <div className="absolute top-0 right-0 p-4">
                <div className="bg-[var(--amber)] text-black text-[8px] font-bold px-2 py-1 rounded uppercase tracking-[2px]">Claude Optimized</div>
              </div>
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-[var(--amber)]/10 rounded-2xl flex items-center justify-center border border-[var(--amber)]/20">
                  <Brain className="w-6 h-6 text-[var(--amber)]" />
                </div>
                <div>
                  <h3 className="text-[12px] tracking-[4px] text-[var(--amber)] uppercase font-bold">Claude Master Edit Prompt</h3>
                  <p className="text-[10px] text-[var(--muted)] uppercase tracking-[1px]">Synthesized from Gap Analysis & Accuracy Report</p>
                </div>
              </div>
              <div className="bg-white/5 p-8 rounded-2xl border border-white/10 font-mono text-[12px] leading-relaxed text-[var(--text)] whitespace-pre-wrap select-all cursor-copy hover:border-[var(--amber)]/30 transition-all group relative">
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] uppercase tracking-widest text-[var(--muted)]">Click to copy</div>
                {claudeSynthesis}
              </div>
              <div className="mt-8 flex justify-center">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(claudeSynthesis);
                    showNotification("Copied to clipboard!", "success");
                  }}
                  className="bg-[var(--amber)] text-black font-mono text-[10px] font-bold tracking-[2px] uppercase px-10 py-4 rounded-full hover:bg-[var(--amber-g)] transition-all shadow-xl shadow-[var(--amber-dim)]"
                >
                  Copy Master Prompt
                </button>
              </div>
            </motion.div>
          )}

          {accResults && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 bg-[var(--s1)] border border-[var(--border)] rounded-xl p-8 relative overflow-hidden shadow-2xl"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-[var(--amber)]"></div>
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-[11px] tracking-[4px] text-[var(--amber)] uppercase font-bold flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4" /> Accuracy Report
                </h3>
                <button 
                  onClick={() => {
                    const blob = new Blob([accResults], { type: 'text/markdown;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `accuracy_report_${new Date().toISOString().slice(0,10)}.md`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="bg-transparent border border-[var(--border)] text-[var(--muted)] font-mono text-[9px] font-bold tracking-[2px] uppercase px-4 py-2 rounded hover:text-[var(--text)]"
                >
                  ⬇ Download .MD
                </button>
              </div>
              <div className="text-sm leading-relaxed text-[var(--text)] whitespace-pre-wrap font-sans prose prose-invert max-w-none bg-[rgba(232,160,32,0.02)] p-8 rounded-lg border border-[rgba(232,160,32,0.1)]">
                {accResults}
              </div>
            </motion.div>
          )}
        </div>
      )}

      {activeTab === 'guardian' && (
        <div className="space-y-8 animate-in fade-in duration-700">
          <div className="text-center mb-6">
            <div className="font-serif italic text-2xl text-[var(--cyan)] mb-2">Guardian AI Monitoring</div>
            <p className="text-[11px] text-[var(--muted)] leading-loose max-w-lg mx-auto">
              The Guardian AI runs parallel to the main scanner, specifically looking for mistakes where important life stories might have been incorrectly rejected.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* SETTINGS BOX */}
            <div className="lg:col-span-1 space-y-6">
              <div className="glass rounded-2xl p-6 border border-[var(--cyan)]/20">
                <div className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold mb-6 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Guardian Settings
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="text-[9px] text-[var(--muted)] uppercase tracking-[2px] font-bold mb-3 block">Sensitivity ({guardianSettings.sensitivity}/10)</label>
                    <input 
                      type="range" min="1" max="10" 
                      value={guardianSettings.sensitivity} 
                      onChange={e => setGuardianSettings(prev => ({ ...prev, sensitivity: parseInt(e.target.value) }))}
                      className="w-full accent-[var(--cyan)]"
                    />
                    <div className="flex justify-between text-[8px] text-[var(--muted)] mt-1 uppercase font-bold">
                      <span>Lenient</span>
                      <span>Strict</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] text-[var(--muted)] uppercase tracking-[2px] font-bold mb-2 block">Focus Areas</label>
                    <textarea 
                      value={guardianSettings.focusAreas}
                      onChange={e => setGuardianSettings(prev => ({ ...prev, focusAreas: e.target.value }))}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl p-3 text-[10px] text-[var(--text)] font-mono min-h-[80px] outline-none focus:border-[var(--cyan)]/50 transition-all"
                      placeholder="e.g. Life changes, emotional nuances..."
                    />
                  </div>

                  <div>
                    <label className="text-[9px] text-[var(--muted)] uppercase tracking-[2px] font-bold mb-2 block">Thinking Level</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setGuardianSettings(prev => ({ ...prev, thinkingLevel: ThinkingLevel.LOW }))}
                        className={`py-2 rounded-lg text-[9px] font-bold uppercase tracking-[1px] border transition-all ${guardianSettings.thinkingLevel === ThinkingLevel.LOW ? 'bg-[var(--cyan)] text-black border-[var(--cyan)]' : 'bg-[var(--s2)] text-[var(--muted)] border-[var(--border)]'}`}
                      >
                        Fast
                      </button>
                      <button 
                        onClick={() => setGuardianSettings(prev => ({ ...prev, thinkingLevel: ThinkingLevel.HIGH }))}
                        className={`py-2 rounded-lg text-[9px] font-bold uppercase tracking-[1px] border transition-all ${guardianSettings.thinkingLevel === ThinkingLevel.HIGH ? 'bg-[var(--cyan)] text-black border-[var(--cyan)]' : 'bg-[var(--s2)] text-[var(--muted)] border-[var(--border)]'}`}
                      >
                        Deep
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-6 bg-[rgba(6,182,212,0.03)] border border-[var(--cyan)]/10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--cyan)]/10 flex items-center justify-center text-[var(--cyan)]">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[var(--text)] uppercase tracking-[1px]">Guardian Status</div>
                    <div className="text-[9px] text-[var(--muted)]">Monitoring active scan...</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-[var(--muted)]">Flagged Mistakes:</span>
                    <span className="text-[var(--red)] font-bold">{guardianFindings.filter(f => f.status === 'flagged').length}</span>
                  </div>
                  <div className="flex justify-between text-[9px]">
                    <span className="text-[var(--muted)]">Restored Items:</span>
                    <span className="text-[var(--green)] font-bold">{guardianFindings.filter(f => f.status === 'restored').length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* FINDINGS BOX */}
            <div className="lg:col-span-2">
              <div className="glass rounded-2xl overflow-hidden border border-[var(--border)] flex flex-col h-full min-h-[500px]">
                <div className="p-4 border-b border-[var(--border)] bg-[rgba(6,182,212,0.05)] flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[var(--cyan)]" />
                    <span className="text-[10px] tracking-[3px] text-[var(--cyan)] uppercase font-bold">Guardian Findings</span>
                  </div>
                  <button 
                    onClick={() => setGuardianFindings([])}
                    className="text-[8px] text-[var(--muted)] hover:text-[var(--red)] uppercase font-bold transition-colors"
                  >
                    Clear Findings
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                  {guardianFindings.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-12">
                      <div className="w-16 h-16 rounded-full bg-[var(--s2)] flex items-center justify-center mb-4 text-[var(--muted)] opacity-20">
                        <Activity className="w-8 h-8" />
                      </div>
                      <div className="text-[11px] text-[var(--muted)] italic">No findings yet. Enable Guardian AI and start a scan to see its analysis.</div>
                    </div>
                  ) : (
                    guardianFindings.map((f, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`p-5 rounded-2xl border transition-all ${f.status === 'restored' ? 'bg-[rgba(16,185,129,0.02)] border-[var(--green)]/20 opacity-60' : 'bg-[var(--s1)] border-[var(--border)] hover:border-[var(--cyan)]/30 shadow-xl shadow-black/20'}`}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-[1px] ${f.status === 'restored' ? 'bg-[var(--green)] text-black' : 'bg-[var(--red)] text-white'}`}>
                              {f.status === 'restored' ? 'Restored' : 'Mistake Flagged'}
                            </span>
                            <span className="text-[9px] text-[var(--muted)] font-mono">ID: {f.uId.substring(0, 8)}</span>
                          </div>
                          {f.status === 'flagged' && (
                            <button 
                              onClick={() => restoreGuardianFinding(f, i)}
                              className="px-4 py-1.5 bg-[var(--cyan)] text-black rounded-lg text-[9px] font-bold uppercase hover:bg-[var(--cyan)]/80 transition-all shadow-lg active:scale-95 flex items-center gap-2"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Restore Entry
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <div>
                              <div className="text-[8px] text-[var(--cyan)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                <Brain className="w-3 h-3" /> Guardian Reasoning
                              </div>
                              <p className="text-[10px] text-[var(--text)] leading-relaxed italic">
                                "{f.guardianReason}"
                              </p>
                            </div>
                            <div>
                              <div className="text-[8px] text-[var(--amber)] uppercase tracking-[2px] font-bold mb-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Proof of Importance
                              </div>
                              <div className="p-3 bg-[var(--bg)] rounded-xl border border-[var(--border)] text-[10px] text-[var(--muted)] leading-relaxed">
                                {f.guardianProof}
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] text-[var(--muted)] uppercase tracking-[2px] font-bold mb-1">Original Content</div>
                            <div className="p-3 bg-[var(--s2)] rounded-xl border border-[var(--border)] text-[10px] text-[var(--muted)] leading-relaxed max-h-[150px] overflow-y-auto custom-scrollbar">
                              {f.text}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[8px] text-[var(--muted)] uppercase">Suggested Importance:</span>
                              <div className="flex gap-0.5">
                                {[...Array(10)].map((_, idx) => (
                                  <div key={idx} className={`w-1.5 h-3 rounded-full ${idx < (f.suggestedImportance || 0) ? 'bg-[var(--cyan)]' : 'bg-[var(--dim)]'}`}></div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="glass rounded-3xl p-8">
            <div className="text-[11px] tracking-[4px] text-[var(--muted)] uppercase mb-6 flex items-center gap-3 font-bold">
              <Sparkles className="w-4 h-4 text-[var(--amber)]" /> Archive Intelligence
              <div className="flex-1 h-px bg-[var(--border)] opacity-30"></div>
            </div>
            <div className="text-[10px] text-[var(--cyan)] tracking-[2px] mb-6 font-medium uppercase">Using top stories as context for deep understanding.</div>
            <div className="flex flex-wrap gap-3">
              <div className="relative model-dropdown-container">
                <button 
                  onClick={() => setOpenDropdown(openDropdown === 'chat' ? null : 'chat')}
                  className="px-4 py-2 bg-[var(--s2)] border border-[var(--border)] rounded-xl text-[10px] text-[var(--muted)] tracking-[2px] uppercase font-bold hover:text-[var(--text)] flex items-center gap-2"
                >
                  <Settings className="w-3.5 h-3.5" />
                  {availableModels.find(m => m.id === modelConfig.chat)?.name || 'Select Model'}
                </button>
                <AnimatePresence>
                  {openDropdown === 'chat' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full left-0 mb-2 w-64 glass rounded-xl shadow-2xl z-50 p-1 border border-[var(--border)]"
                    >
                      {availableModels.map(m => (
                        <button 
                          key={m.id}
                          onClick={() => {
                            setModelConfig(prev => ({ ...prev, chat: m.id }));
                            setOpenDropdown(null);
                          }}
                          className={`w-full text-left px-4 py-3 rounded-lg text-[10px] font-mono uppercase tracking-widest hover:bg-[var(--s2)] ${modelConfig.chat === m.id ? 'text-[var(--amber)] bg-[var(--amber-dim)]' : 'text-[var(--muted)]'}`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {['Recurring themes', 'Key people', 'Fears & struggles', 'Defining moments'].map(p => (
                <button 
                  key={p} 
                  onClick={() => setChatInput(p)} 
                  className="px-4 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[10px] text-[var(--muted)] tracking-[2px] uppercase font-bold hover:border-[var(--cyan)] hover:text-[var(--cyan)] hover:bg-[rgba(6,182,212,0.05)] transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className={`glass rounded-3xl overflow-hidden shadow-2xl flex flex-col transition-all duration-500 ${isChatMinimized ? 'h-[60px]' : 'h-[400px]'}`}>
            <div className="px-8 py-4 border-b border-[var(--border)] bg-[var(--s1)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-[var(--amber)]" />
                <span className="text-[10px] font-bold uppercase tracking-[2px] text-[var(--text)]">Conversation</span>
              </div>
              <button 
                onClick={() => setIsChatMinimized(!isChatMinimized)}
                className="p-2 hover:bg-[var(--dim)] rounded-lg text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                title={isChatMinimized ? "Expand Chat" : "Minimize Chat"}
              >
                {isChatMinimized ? <ChevronDown className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </button>
            </div>
            
            <AnimatePresence initial={false}>
              {!isChatMinimized && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex-1 flex flex-col overflow-hidden"
                >
                  <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8 custom-scrollbar">
                    {chatHistory.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center text-[var(--muted)] p-12">
                        <div className="w-24 h-24 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mb-8 relative">
                          <MessageSquare className="w-10 h-10 text-[var(--amber)]" />
                          <div className="absolute inset-0 rounded-full border border-[var(--amber)]/20 animate-ping"></div>
                        </div>
                        <strong className="text-[var(--text)] text-2xl font-serif italic block mb-4">Archive Intelligence</strong>
                        <p className="text-[11px] tracking-[2px] max-w-xs uppercase opacity-60 leading-relaxed">Synthesize your life stories through natural conversation. The neural engine is ready.</p>
                      </div>
                    )}
                    {chatHistory.map((msg, i) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={i} 
                        className={`flex gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                      >
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-[10px] shrink-0 font-serif shadow-xl border ${msg.role === 'user' ? 'bg-[var(--amber)] text-black border-amber-400 font-bold' : 'bg-white/5 text-[var(--text)] border-white/10 font-bold'}`}>
                          {msg.role === 'user' ? 'YOU' : 'AI'}
                        </div>
                        <div className={`max-w-[80%] p-6 rounded-3xl text-[13px] leading-relaxed shadow-2xl relative ${msg.role === 'user' ? 'bg-[var(--amber)]/10 border border-[var(--amber)]/20 text-[var(--text)]' : 'bg-white/5 border border-white/10 text-[var(--text)]'}`}>
                          <div className="whitespace-pre-wrap font-sans">{msg.content || msg.text}</div>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-6 pt-6 border-t border-white/10">
                              <p className="text-[9px] font-mono uppercase tracking-[3px] text-[var(--muted)] mb-3">Grounding Sources</p>
                              <div className="flex flex-wrap gap-2">
                                {msg.sources.map((url: string, idx: number) => (
                                  <a 
                                    key={idx} 
                                    href={url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[10px] bg-white/5 px-3 py-1.5 rounded-full border border-white/10 text-[var(--cyan)] hover:text-[var(--amber)] hover:border-[var(--amber)]/30 transition-all truncate max-w-[180px] font-medium"
                                  >
                                    {new URL(url).hostname}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {isChatLoading && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-6">
                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-[10px] shrink-0 font-serif bg-white/5 text-[var(--text)] border border-white/10 font-bold animate-pulse">AI</div>
                        <div className="max-w-[80%] p-6 rounded-3xl text-[13px] leading-relaxed bg-white/5 border border-white/10 text-[var(--muted)] italic animate-pulse">
                          Synthesizing archive context...
                        </div>
                      </motion.div>
                    )}
                  </div>
                  <div className="p-4 bg-[var(--s1)] border-t border-[var(--border)]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[8px] font-bold uppercase tracking-[1px] transition-all border ${
                            isWebSearchEnabled 
                              ? 'bg-[var(--cyan-dim)] text-[var(--cyan)] border-[var(--cyan)]/30' 
                              : 'bg-[var(--s2)] text-[var(--muted)] border-[var(--border)]'
                          }`}
                        >
                          <Search className={`w-2.5 h-2.5 ${isWebSearchEnabled ? 'text-[var(--cyan)]' : ''}`} />
                          Search: {isWebSearchEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>
                    <div className="relative flex items-center">
                      <textarea
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                        placeholder="Ask something about your life stories…"
                        className="w-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] font-sans text-[11px] p-3 pr-12 rounded-xl outline-none resize-none h-12 placeholder:text-[var(--muted)] focus:border-[var(--amber)] transition-all shadow-inner"
                      />
                      <button
                        onClick={sendChat}
                        disabled={isChatLoading || !chatInput.trim()}
                        className="absolute right-2 p-2 bg-[var(--amber)] text-black rounded-lg hover:bg-[var(--amber-g)] transition-all disabled:opacity-50 disabled:grayscale shadow-lg active:scale-90"
                      >
                        <Sparkles className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      {notification && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[300] w-full max-w-md px-4"
          >
            <div className={`glass-heavy rounded-2xl p-3 shadow-2xl border flex items-center gap-3 ${
              notification.type === 'error' ? 'border-red-500/30 bg-red-500/5' : 
              notification.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' : 
              'border-cyan-500/30 bg-cyan-500/5'
            }`}>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${
                notification.type === 'error' ? 'bg-red-500 text-white' : 
                notification.type === 'success' ? 'bg-emerald-500 text-white' : 
                'bg-cyan-500 text-white'
              }`}>
                {notification.type === 'error' && <AlertCircle className="w-4 h-4" />}
                {notification.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
                {notification.type === 'info' && <Sparkles className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold text-[var(--text)] leading-tight">{notification.msg}</div>
              </div>
              <button 
                onClick={() => setNotification(null)} 
                className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-[var(--muted)] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* GLOBAL PROCESS INDICATOR */}
      <AnimatePresence>
        {(isAiLoading || isSummarizing || isComparing || isAccChecking || isProcessingFiles) && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[250] bg-zinc-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl px-5 py-2.5 shadow-2xl flex items-center gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping absolute inset-0"></div>
                <div className="w-2 h-2 rounded-full bg-amber-500 relative"></div>
              </div>
              <span className="text-[10px] font-bold tracking-[2px] uppercase text-white/90">
                {isProcessingFiles ? 'Processing Files' : isAiLoading ? 'AI Scanning' : isSummarizing ? 'Analyzing Archive' : isComparing ? 'Comparing Files' : 'Checking Accuracy'}
              </span>
            </div>
            <div className="w-px h-4 bg-white/10"></div>
            <button 
              onClick={() => {
                setIsProcessingFiles(false);
                resetAiExtract();
                resetSummary();
                resetComparison();
                resetAccuracy();
              }}
              className="px-3 py-1 rounded-lg bg-red-500/10 text-red-500 text-[9px] font-bold tracking-[1px] uppercase hover:bg-red-500 hover:text-white transition-all flex items-center gap-1.5 active:scale-95"
            >
              <X className="w-3 h-3" /> Stop All
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ACCOUNT CONNECTION MODAL */}
      <AnimatePresence>
        {isConnectModalOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConnectModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md glass rounded-3xl p-8 shadow-2xl border border-[var(--amber)]/30"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-[var(--amber)]" />
                  <h3 className="text-[12px] font-bold uppercase tracking-widest text-[var(--text)]">Account Connection</h3>
                </div>
                <button onClick={() => setIsConnectModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-4 h-4 text-[var(--muted)]" />
                </button>
              </div>
              
              <div className="space-y-4 text-[11px] leading-relaxed text-[var(--muted)]">
                <p>
                  Your application is <span className="text-[var(--green)] font-bold">already connected</span> to your Google AI Studio account via the secure API key provided by the platform.
                </p>
                <p>
                  The usage data you see in this app is tracked locally to provide immediate feedback. For your official billing, token counts, and project-wide quotas, please visit the Google AI Studio console directly.
                </p>
                
                <div className="p-4 bg-white/5 rounded-xl border border-white/10 mt-6">
                  <h4 className="text-[10px] font-bold text-[var(--text)] uppercase mb-2">Real-time Usage Console</h4>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--s2)] hover:bg-[var(--s3)] transition-all group"
                  >
                    <span className="text-[var(--cyan)]">View AI Studio Dashboard</span>
                    <ChevronRight className="w-4 h-4 text-[var(--cyan)] group-hover:translate-x-1 transition-transform" />
                  </a>
                </div>
              </div>
              
              <button 
                onClick={() => setIsConnectModalOpen(false)}
                className="w-full mt-8 py-4 rounded-xl bg-[var(--amber)] text-black font-bold uppercase tracking-[2px] text-[10px] hover:bg-[var(--amber-g)] transition-all"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
