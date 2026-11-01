'use strict';

// Python books whose converter bolds keywords and italicizes comments, such
// as Natural Language Processing with Transformers:
//   **class MultiHeadAttention**(nn.Module): **def** __init__(self, config): ...
//   ... *# Place all input tensors on the same device as the model* inputs = ...

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanMarkdown, stripBoldCode } = require('../../py/clean-markdown.cjs');
const { formatMarkdown } = require('../../py/format-python.cjs');

const run = markdown => formatMarkdown(cleanMarkdown(markdown), 88).text;

test('a paragraph starting with a bolded class is fenced and formatted', () => {
  const input = [
    'Some prose.',
    '',
    '**class MultiHeadAttention**(nn.Module): **def** \\_\\_init\\_\\_(self, config): super().\\_\\_init\\_\\_() embed\\_dim = config.hidden\\_size num\\_heads = config.num\\_attention\\_heads head\\_dim = embed\\_dim // num\\_heads self.heads = nn.ModuleList( [AttentionHead(embed\\_dim, head\\_dim) **for** \\_ **in** range(num\\_heads)] ) self.output\\_linear = nn.Linear(embed\\_dim, embed\\_dim)',
    '',
    'More prose.',
  ].join('\n');
  assert.equal(run(input), [
    'Some prose.',
    '',
    '```py',
    'class MultiHeadAttention(nn.Module):',
    '    def __init__(self, config):',
    '        super().__init__()',
    '        embed_dim = config.hidden_size',
    '        num_heads = config.num_attention_heads',
    '        head_dim = embed_dim // num_heads',
    '        self.heads = nn.ModuleList(',
    '            [AttentionHead(embed_dim, head_dim) for _ in range(num_heads)]',
    '        )',
    '        self.output_linear = nn.Linear(embed_dim, embed_dim)',
    '```',
    '',
    'More prose.',
  ].join('\n'));
});

test('bolded multi-word imports are recognized', () => {
  assert.equal(run('**from datasets import** load\\_dataset emotions = load\\_dataset("emotion")'),
    '```py\nfrom datasets import load_dataset\nemotions = load_dataset("emotion")\n```');
});

test('italic comments end at their closing * and stand on their own line above the code', () => {
  const input = '**def** forward(batch): *# Convert dict of lists to list of dicts* features = [dict(zip(batch, t)) **for** t **in** zip(*batch.values())] *# Pad inputs and labels* batch = collate(features) **return** batch';
  assert.equal(run(input), [
    '```py',
    'def forward(batch):',
    '    # Convert dict of lists to list of dicts',
    '    features = [dict(zip(batch, t)) for t in zip(*batch.values())]',
    '    # Pad inputs and labels',
    '    batch = collate(features)',
    '    return batch',
    '```',
  ].join('\n'));
});

test('two comment lines joined in one italic span become two lines', () => {
  const input = '**with** torch.no\\_grad(): output = model(x) *# logit.size: [batch, classes] # Predict class with largest logit* pred = output.argmax(-1)';
  assert.match(run(input), /\n {4}# logit\.size: \[batch, classes\]\n {4}# Predict class with largest logit\n {4}pred = output\.argmax\(-1\)\n/);
});

test('only highlighting is removed: Python\'s own ** and other bold text stay', () => {
  assert.equal(stripBoldCode('f(**kwargs) + a**2'), 'f(**kwargs) + a**2');
  assert.equal(stripBoldCode('**Listing 2.1** A caption'), '**Listing 2.1** A caption');
  assert.equal(stripBoldCode('**from datasets import** x'), 'from datasets import x');
  assert.equal(stripBoldCode('the **importance** of'), 'the **importance** of', 'a word merely starting with a keyword is not highlighting');
});

test('bolded escape sequences inside strings and italic docstrings lose their markers', () => {
  assert.equal(stripBoldCode('"**\\n**".join(lines)'), '"\\n".join(lines)');
  assert.equal(stripBoldCode("'hasn**\\'**t'"), "'hasn\\'t'");
  assert.equal(stripBoldCode('marker=\'$**\\u25CC**$\''), 'marker=\'$\\u25CC$\'');
  assert.equal(stripBoldCode('*"""Compute the size."""* size = 1'), '"""Compute the size.""" size = 1');
});

test('prose with a bolded keyword stays prose', () => {
  const prose = '**For** example, the tokenizer splits words into subwords.';
  assert.equal(run(prose), prose);
});

test('a callout marker (#A ... #E) ends its comment: the code after it stays code', () => {
  const input = '**def** decode(self, ids): #D text = " ".join([self.int\\_to\\_str[i] **for** i **in** ids]) text = re.sub(r\'\\s+([,.?!"()\\\'])\', r\'\\1\', text) #E **return** text';
  assert.equal(run(input), [
    '```py',
    'def decode(self, ids):  #D',
    '    text = " ".join([self.int_to_str[i] for i in ids])',
    '    text = re.sub(r\'\\s+([,.?!"()\\\'])\', r\'\\1\', text)  #E',
    '    return text',
    '```',
  ].join('\n'));
});
