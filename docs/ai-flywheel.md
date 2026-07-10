# AI Flywheel — Niyet-Katmanlı Hibrit Mimari

WhatsApp chatbot'una eklenen iki aşamalı yanıt mimarisi + eğitim verisi toplama (flywheel) döngüsünün özeti.

## Mimari

Her misafir mesajı (yalnızca hibrit mod aktifken) iki aşamadan geçer:

```
misafir mesajı
   │
   ├─ 1) ANALİZ — yerel Qwen (ücretsiz, her mesajda)
   │     apps/api/src/services/nlu/intent-analysis.service.ts
   │     → { language, intents, actionableIntentCount, urgency,
   │         isConfirmation, negativeConstraint, negativeConstraintText }
   │     + LLM'siz regex dedektörü (OR'lanır):
   │       /(sadece|yalnız(?:ca)?|hariç|olmasın|istemiyorum|koyma|ekleme|açma|dışında)/i
   │
   ├─ 2) ROUTER — apps/api/src/services/ai/model-router.service.ts
   │     actionableIntentCount >= 2 || negativeConstraint → 'sonnet'
   │     değilse                                          → 'haiku'
   │     ANTHROPIC_API_KEY yok veya AI_ROUTER_ENABLED=false → 'local'
   │
   ├─ Sipariş çıkarımı (ürün eşleştirme) HER ZAMAN mevcut yerel yolda kalır
   │     (llm-extractor.service.ts — davranış değişmedi)
   │
   ├─ Yanıt üretimi:
   │     'local'          → mevcut yol aynen
   │     'haiku'/'sonnet' → apps/api/src/services/ai/claude-client.service.ts
   │                        (aynı menü/sipariş bağlamıyla; hata → yerel metne düşer)
   │     Yalnız serbest-metin netleştirme yanıtları Claude'a gider;
   │     interaktif opsiyon listeleri ve fiyat içeren sipariş özetleri
   │     her zaman yerel/şablon yolunda kalır.
   │
   └─ NEGATİF KISIT KAPISI (yalnız hibrit modda):
         negativeConstraint=true → sipariş OTOMATİK OLUŞTURULMAZ,
         müşteriye "not aldım, görevlimiz onaylayacak" yanıtı döner,
         konuşma mevcut PENDING_AGENT inbox bayrağıyla insan incelemesine düşer.
```

Entegrasyon noktası: `apps/api/src/services/nlu/orchestrator.service.ts` →
`NluOrchestratorService.processMessage()` (tüm conversation-flow çağrıları bu
tek noktadan geçer). **ANTHROPIC_API_KEY tanımlı değilken kod yolu bugünkünün
birebir aynısıdır** — analiz çağrısı dahil hiçbir ek adım çalışmaz.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Yoksa sistem tamamen yerel (Qwen) çalışır |
| `AI_MODEL_SIMPLE` | `claude-haiku-4-5` | Basit yanıtlar için model |
| `AI_MODEL_COMPLEX` | `claude-sonnet-4-6` | Çok niyetli / negatif kısıtlı mesajlar için model |
| `AI_ROUTER_ENABLED` | `true` | `false` → her zaman yerel (kill switch) |

Model kimliklerine tarih eki EKLEME (`claude-haiku-4-5` doğru,
`claude-haiku-4-5-2025...` yanlış).

## Flywheel — eğitim verisi toplama

Claude'un ürettiği HER yanıt bir öğretmen örneği olarak kaydedilir
(`apps/api/src/services/ai/training-capture.service.ts`, fire-and-forget):

- Prisma modeli: `AiTrainingSample` (`ai_training_samples` tablosu,
  migration: `20260710000000_ai_training_sample`).
- PII maskesi: telefon → `[TEL]`, e-posta → `[EPOSTA]`, "adres" geçen
  satırlar → `[ADRES]`.
- `contextJson` = `{ system, history }`, `intentJson` = analiz çıktısı.

### Export (JSONL)

```bash
node scripts/export-training.mjs --out train.jsonl            # tümü
node scripts/export-training.mjs --tenant <id> --since 2026-07-01
node scripts/export-training.mjs --with-history               # geçmiş turlarla
```

Satır formatı (chat fine-tune standardı):

```json
{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

## QLoRA eğitim komut taslağı

Örnek: Qwen2.5-7B-Instruct üzerine LLaMA-Factory ile QLoRA (tek GPU, 24GB):

```bash
# 1) Veriyi ayır: %90 train, %10 eval
node scripts/export-training.mjs --out data/flywheel.jsonl
split -l $(( $(wc -l < data/flywheel.jsonl) * 9 / 10 )) data/flywheel.jsonl data/part_
mv data/part_aa data/train.jsonl; mv data/part_ab data/eval.jsonl

# 2) QLoRA eğitimi (llamafactory-cli, sharegpt/messages formatı)
llamafactory-cli train \
  --stage sft --do_train \
  --model_name_or_path Qwen/Qwen2.5-7B-Instruct \
  --dataset flywheel --dataset_dir data \
  --template qwen --finetuning_type lora \
  --quantization_bit 4 \
  --lora_rank 16 --lora_alpha 32 --lora_dropout 0.05 \
  --per_device_train_batch_size 2 --gradient_accumulation_steps 8 \
  --learning_rate 1e-4 --num_train_epochs 3 --bf16 \
  --output_dir out/qwen-whatres-lora

# 3) LoRA'yı birleştir + Ollama'ya al
llamafactory-cli export --model_name_or_path Qwen/Qwen2.5-7B-Instruct \
  --adapter_name_or_path out/qwen-whatres-lora --export_dir out/qwen-whatres-merged
# GGUF'a çevir (llama.cpp convert) ve Modelfile ile: ollama create qwen-whatres:candidate
```

## Eval kapısı (promote süreci)

Eğitilmiş model, **mevcut senaryo setinde baseline'ı geçmeden promote edilmez**:

1. **Senaryo seti**: chatbot test konsolundaki mevcut senaryolar + flywheel
   eval bölümü (`data/eval.jsonl`). Her senaryo için beklenen davranış:
   doğru ürün/opsiyon çıkarımı, doğru netleştirme sorusu, negatif kısıt
   tespiti.
2. **Baseline ölçümü**: mevcut Qwen (`OPENAI_MODEL`) ile senaryo setini çalıştır,
   metrikleri kaydet (çıkarım doğruluğu, JSON geçerlilik oranı,
   clarification isabeti).
3. **Aday ölçümü**: `OPENAI_MODEL=qwen-whatres:candidate` ile aynı seti çalıştır.
4. **Kapı**: aday, TÜM metriklerde baseline'a eşit veya daha iyi değilse
   promote EDİLMEZ; veri toplamaya devam edilir.
5. **Promote**: `OPENAI_MODEL` env'ini yeni model adına çevir + API restart.
   Router mantığı değişmez; zamanla haiku/sonnet trafiği azalır (flywheel).

## Doğrulama

```bash
npx nx build api                 # tip kontrolü + build
node scripts/smoke-intent.mjs    # regex dedektörü + router kuralı (LLM'siz)
```
