var fso = new ActiveXObject( Scripting.FileSystemObject);
var file = fso.OpenTextFile(D:\\Taxote\\app.js, 1);
var text = file.ReadAll();
file.Close();
try {
  new Function(text);
  WScript.Echo('Syntax OK');
} catch(e) {
  WScript.Echo('Syntax Error: ' + e.message);
}
