# cc-room

> ホワイトボードのある会議室に、各自が自分の Claude を連れて入る。

各エンジニアが自分の Claude Code で自分のペースで作業しながら、**公開中**（Private OFF）ならサマリー・成果物が自動でホワイトボード（Primary ルーム）に出る。手元の作業は `/private on` で誰にも見えない。`@name` で人間同士も直接やりとりできる。

```
既存ツール = 「1つのAIを複数人で操作する」 or 「複数のAIを協調させる」
cc-room    = 「各自のAIが同じ会議室にいて、ホワイトボードを通じて連携する」
```

[English README](./README.md)

---

## なぜ今 cc-room か

Claude Code 向けの**公式マルチプレイヤーは、まだ一般提供されていません**。  
cc-room は公式拡張ポイント（Hooks / MCP / Slash Commands）だけを使い、**今すぐ**同一 LAN のチームで「会議室」体験を使える非公式ツールです。

- **体験**: 各自の Claude が同じ部屋にいる（ホワイトボード連携）
- **簡単**: セットアップは一発。外部サーバーなし、クラウド送信なし
- **プライバシー**: `/private` で手元と公開を切替。会話の生テキストやプライベートツール結果は出さない

個人実験から始まったプロジェクトですが、動くものを「試して・チームに持ち込める」形で公開しています。

---

## なぜ作ったか

cc-room が目指すのは、**ペアプロのようなリアルタイムなコンテキスト共有**です。テスト版として、**ローカル LAN 限定**の「仮想会議室」をイメージしています。データが外部に出ないことを最優先にしつつ、チャット・成果物・途中経過のコンテキストを自然に共有できる環境を作りたかった、というのが出発点です。

### 解決したかったこと

1. **「相談」のためだけに PR を作るのが重い**  
   コミット前・WIP の段階で方向性だけ見てもらいたい場面は多いのに、Draft PR を立ててレビュー依頼するのは心理的・手続き的にハードルが高い。cc-room なら**コードを書いている最中のコンテキストごと**相手に流れるので、「今これ書いてるんだけど」が自然に共有できる。

2. **画面共有の延長ではない、本当の共同作業**  
   Claude Squad や tmate、VS Code Live Share などは「同じ画面を見る」モデルになりやすく、誰かが手を止めがちになる。cc-room は**各自が自分のペースで作業しながら、コンテキストだけ自動共有**するので、誰も手を止めなくてよい。

3. **ツール切り替えによる思考の断絶**  
   Slack を開いた瞬間に通知へ気を取られ、「何してたっけ…」になりやすい。cc-room は**ターミナル／エディタ内で完結**し、開発フローを壊さない。

4. **開発合宿の「同じ空気」を仮想化**  
   合宿が楽しい本質は「みんなが同じものに取り組んでいる空気」。物理空間ではなく、**コンテキストの流通**でその空気を再現する。

5. **AI との正しい関係性**  
   「AI に仕事させる」ではなく、**AI と人で一緒に作る**。人間がクリエイティブな判断をし、AI がそれを加速する。人間同士の会話に AI のコンテキスト理解が加わる形で、**主体は人間**のままにする。

6. **企業コードの機密性**  
   企業のコードベースは最も機密性の高い資産のひとつ。クラウド経由のツールを本能的に避けたい現場向けに、**LAN 内完結**でデータが建物の外に出ない設計にした。Anthropic API も**各自の既存キー**を使うだけ。

### まとめ

AI Coding が「AI にやらせる」になりがちな反省から生まれた、**人間中心**のコラボレーションツールです。特に**企業内・機密情報を扱う開発現場**で価値を発揮するコンセプトです。その思想は今も変わっていません——下の Quick Start から試して、チームに持ち込んでください。

---

## Quick Start

```bash
# 日本語 UI / コマンドでインストール
npx setup-cc-room --lang ja
# または: CC_ROOM_LANG=ja npx setup-cc-room
```

デフォルト（フラグなし）は英語です。

```bash
npx setup-cc-room
```

Claude Code を開き:

```
/room open my-room          # 会議室を作る（PIN が発行される）
```

同じ LAN のチームメイトは:

```
/room join my-room <PIN>    # 入室
```

### アンインストール

```bash
npx setup-cc-room uninstall
```

daemon（launchd/systemd）、slash commands、`settings.json` の cc-room 設定、`~/.cc-room` を削除します。その後 Claude Code を再起動してください。

開発者向け（ソースから）:

```bash
git clone https://github.com/takanorisuzuki/cc-room.git
cd cc-room && pnpm install && pnpm build
pnpm --filter setup-cc-room run pack:vendor
node packages/setup/dist/index.js --lang ja
# アンインストール: node packages/setup/dist/index.js uninstall
```

---

## 使い方

```
/room open auth-feature     # 会議室を作る（PIN が発行される。Primary になる）
/room join auth-feature <PIN>  # チームメイトが入室（2部屋目は Watch = Read Only）
/room switch other-room     # Primary（執筆するルーム）を切替
/room                       # ホワイトボードを見る
/room remember "JWT方式: パターンB、TTL 3日"   # 付箋を貼る

/private on                 # 手元モード（執筆は pending に蓄積、誰にも見えない）
/private off                # 公開へ戻る（pending があれば毎回 share/drop を選択）

/show "TTLは3日にすべき"    # Primary へメッセージ投稿
/show skill deep-research   # スキルを部屋に共有
/show claude-md             # CLAUDE.md を共有

/room leave                 # 退室
```

入室するとホワイトボードの内容（サマリー・成果物・メッセージ）が自動で同期される。

- **Primary** — 執筆するルーム（1つだけ）。サマリー・成果物・Dream はここへ流れる
- **Watch** — 見るだけ（Read Only）。2部屋目以降の join はデフォルト Watch
- **公開中**（Private OFF）— サマリー・成果物が Primary へ自動配信される状態
- **`/private on`** — 手元モード。戻すときは毎回 share（送る）/ drop（捨てる）を選ぶ（自動 flush なし）

### @メンション（人間同士のやりとり）

Claude Code の入力欄で `@` から始めると、**人間に直接**届く（Claude への指示ではない）。

| 構文 | 届く先 |
|---|---|
| `@akira JWT終わったよ` | akira だけ |
| `@here ランチ行く人いる？` | 公開中（Primary かつ Private OFF）のメンバー全員 |
| `@all デプロイ完了しました` | 部屋の全員（Private ON/OFF 問わず） |

- 送信者が公開中（Private OFF）なら作業サマリー付きで届く（Private ON / Watch ではサマリーなし、本文のみ）
- 受信側はステータスラインに `📬 N件` が表示される
- 次に Claude に話しかけると、未読メンションがプロンプト先頭にバナーとして差し込まれ、Claude も把握する
- `@dataclass` など部屋にいない名前は通常入力として Claude に渡る（誤検出しない）

---

## 何が共有されるか

| データ | 公開中（Private OFF） | Private ON |
|---|---|---|
| 会話サマリー（技術作業） | リアルタイム自動（Primary のみ） | pending に蓄積（非公開） |
| 生成ファイル (Write/Edit) | リアルタイム自動（Primary のみ） | pending に蓄積（非公開） |
| `/show "msg"` のメッセージ | 即時 | 確認後に投稿 |
| `@メンション` 本文 | 宛先のみ（送信者サマリー付き） | 宛先のみ（サマリーなし） |
| `/room remember` のメモ | 即時 | 即時 |
| 会話の生テキスト | 常に非公開 | 常に非公開 |
| プライベートツール結果 | 自動除外 | 非公開 |

配信条件は「Primary ルーム AND Private OFF AND プライバシーフィルタ通過」。Watch ルームへは自動執筆しない。

---

## 仕組み

```
Alice の Claude Code
  └─ session jsonl を監視 → 差分サマリ生成 → WebSocket (LAN) →
                                                Bob の ~/.cc-room/ に保存
                                                └─ MCP tool で取得 → Bob の Claude Code が文脈を持った状態で回答
```

- **LAN 内のみ**: mDNS + WebSocket。外部サーバーなし、クラウド送信なし
- **Claude Code 無改造**: Hooks / MCP Server / Slash Commands の公式拡張ポイントのみ使用
- **各自のAPIキー**: Anthropic API は各自のキーで各自が呼ぶ
- **部屋の認証**: 名前 + 6桁 PIN → HKDF で HMAC キー導出
- **中間サマリー**: 公開中（Private OFF）が 30 分以上続くと自動でサマリーを共有

---

## 要件

- Node.js 20+
- Claude Code
- 同一 LAN（WiFi / 有線）内のチームメイト

---

## 開発

```bash
pnpm install
pnpm build
pnpm --filter setup-cc-room run pack:vendor
pnpm test
```

---

## License

MIT
