'use strict';

const NodeType = {
  PROGRAM:        'Program',
  VAR_DECL:       'VarDecl',
  FN_DECL:        'FnDecl',
  STRUCT_DECL:    'StructDecl',
  RETURN_STMT:    'ReturnStmt',
  IF_STMT:        'IfStmt',
  BLOCK:          'Block',
  EXPR_STMT:      'ExprStmt',
  ASSIGN_EXPR:    'AssignExpr',
  BINARY_EXPR:    'BinaryExpr',
  UNARY_EXPR:     'UnaryExpr',
  CALL_EXPR:      'CallExpr',
  MEMBER_EXPR:    'MemberExpr',
  STRUCT_INIT:    'StructInit',
  IDENTIFIER:     'Identifier',
  NUMBER_LITERAL: 'NumberLiteral',
  STRING_LITERAL: 'StringLiteral',
  BOOL_LITERAL:   'BoolLiteral',
  ARRAY_LITERAL:  'ArrayLiteral', // [1, 2, 3]
  LOOP_STMT:      'LoopStmt',     // untuk (range or for-of)
  WHILE_STMT:     'WhileStmt',    // selama
  AWAIT_EXPR:     'AwaitExpr',    // tunggu
  FUNC_EXPR:      'FuncExpr',     // anonymous function expression
  TRY_STMT:       'TryStmt',      // coba/tangkap/akhirnya
  NULL_LITERAL:   'NullLiteral',  // kosong
  BREAK_STMT:     'BreakStmt',    // berhenti
  CONTINUE_STMT:  'ContinueStmt', // lanjut
  TYPE_ALIAS_DECL:'TypeAliasDecl',// tipe
  MATCH_STMT:     'MatchStmt',    // pilih expr / kasus / lain
  TEST_DECL:      'TestDecl',     // uji "label" { ... }
  ASSERT_STMT:    'AssertStmt',   // pastikan expr
  OBJECT_LITERAL:   'ObjectLiteral',   // { key: val, ... }
  TEMPLATE_EXPR:    'TemplateExpr',    // f"Hello {nama}"
  DESTRUCTURE_DECL: 'DestructureDecl', // isi { id, nama } = obj / isi [a, b] = arr
  SPREAD_ELEMENT:   'SpreadElement',   // ...expr
  TERNARY_EXPR:     'TernaryExpr',     // expr jika cond lain alt
  PACKAGE_DECL:   'PackageDeclaration',
  PACKAGE_IMPORT: 'PackageImport',
  INDEX_EXPR:     'IndexExpr',    // obj[key]
  JS_BLOCK_STMT:  'JsBlockStmt',  // javascript { ...raw... }
  OBJECT_TRANSFORM_EXPR: 'ObjectTransformExpr', // dengan X { ... } / ubah X { ... }
  MATCH_RESULT_STMT: 'MatchResultStmt', // cocok expr { berhasil(n) => ... gagal(e) => ... }
  MEASURE_STMT: 'MeasureStmt', // ukur "label" { ... }
};

module.exports = { NodeType };
