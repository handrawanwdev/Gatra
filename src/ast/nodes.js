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
  BORROW_EXPR:    'BorrowExpr',   // &x  or  &mut x
  DEREF_EXPR:     'DerefExpr',    // *r
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
  MATCH_STMT:     'MatchStmt',    // cocok / kasus / lain
  TEST_DECL:      'TestDecl',     // uji "label" { ... }
  ASSERT_STMT:    'AssertStmt',   // pastikan expr
  SPAWN_EXPR:        'SpawnExpr',       // jalankan pekerjaFn(args)
  TASK_STMT:         'TaskStmt',        // tugas expr()
  STRUCTURED_SPAWN:  'StructuredSpawn', // jalankan { ... } tunggu
  SELECT_STMT:       'SelectStmt',      // pilih { kasus saluran -> ... }
  OBJECT_LITERAL:   'ObjectLiteral',   // { key: val, ... }
  TEMPLATE_EXPR:    'TemplateExpr',    // f"Hello {nama}"
  DESTRUCTURE_DECL: 'DestructureDecl', // isi { id, nama } = obj / isi [a, b] = arr
  SPREAD_ELEMENT:   'SpreadElement',   // ...expr
  TERNARY_EXPR:     'TernaryExpr',     // expr jika cond lain alt
  PACKAGE_DECL:   'PackageDeclaration',
  PACKAGE_IMPORT: 'PackageImport',
};

module.exports = { NodeType };
