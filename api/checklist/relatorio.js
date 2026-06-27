// ======================================================
// API • ENVIAR TEMPLATE CHECKLIST DIA ANTERIOR
// Envia separado por empresa usando o mesmo template
// ======================================================

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

import { createClient } from "@supabase/supabase-js";

/* ======================================================
CONFIG SUPABASE
====================================================== */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ======================================================
CONFIG WHATSAPP
====================================================== */

const TOKEN =
  process.env.TOKEN_PHONE_OTTO;

const PHONE_NUMBER_ID =
  process.env.PHONE_OTTO || "1211706372019318";

const TEMPLATE_NAME =
  "checklist_dia_anterior";

const LANGUAGE_CODE =
  "pt_BR";

/* ======================================================
CLIENT SUPABASE
====================================================== */

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );

/* ======================================================
EMPRESAS PADRÃO
====================================================== */

const EMPRESAS_PADRAO = [
  "MERCATTO DELICIA",
  "VILLA GOURMET",
  "PADARIA DELICIA",
  "DELICIA GOURMET",
  "MERCATTO KIDS"
];

/* ======================================================
HELPERS
====================================================== */

function limparNumero(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizarTexto(valor) {
  return String(valor || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function statusNormalizado(status) {
  return normalizarTexto(status);
}

function formatarPercentual(valor) {
  if (!Number.isFinite(valor)) {
    return "0%";
  }

  return `${Math.round(valor)}%`;
}

function dataBahiaAgora() {
  const agora = new Date();

  const partes =
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Bahia",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(agora)
      .reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});

  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second)
  };
}

/* ======================================================
PERÍODO OPERACIONAL DO DIA ANTERIOR
04:00 de ontem até 03:59:59 de hoje
====================================================== */

function periodoOperacionalDiaAnterior() {
  const b =
    dataBahiaAgora();

  let inicioHojeOperacional =
    new Date(
      `${b.ano}-${pad2(b.mes)}-${pad2(b.dia)}T04:00:00-03:00`
    );

  // Se ainda for antes das 04:00,
  // o dia operacional atual começou ontem às 04:00
  if (b.hora < 4) {
    inicioHojeOperacional.setDate(
      inicioHojeOperacional.getDate() - 1
    );
  }

  const inicio =
    new Date(inicioHojeOperacional);

  inicio.setDate(
    inicio.getDate() - 1
  );

  const fim =
    new Date(inicioHojeOperacional);

  fim.setMilliseconds(
    fim.getMilliseconds() - 1
  );

  return {
    inicio,
    fim,
    inicioIso: inicio.toISOString(),
    fimIso: fim.toISOString()
  };
}

/* ======================================================
CÁLCULO DO RESUMO
====================================================== */

function montarResumoChecklist(tarefas) {
  const total =
    tarefas.length;

  const concluidas =
    tarefas.filter(t => {
      return statusNormalizado(t.status) === "CONCLUIDO";
    }).length;

  const naoConcluidas =
    total - concluidas;

  const percentualConcluidas =
    total > 0
      ? (concluidas / total) * 100
      : 0;

  const percentualNaoConcluidas =
    total > 0
      ? (naoConcluidas / total) * 100
      : 0;

  return {
    total,
    concluidas,
    naoConcluidas,
    percentualConcluidas: formatarPercentual(percentualConcluidas),
    percentualNaoConcluidas: formatarPercentual(percentualNaoConcluidas)
  };
}

/* ======================================================
BUSCAR TAREFAS DO DIA ANTERIOR
====================================================== */

async function buscarTarefasDiaAnterior(periodo, empresasFiltro) {
  let query =
    supabase
      .from("tarefas_checklist")
      .select(`
        id,
        empresa,
        status,
        created_at,
        data_limite,
        ativo,
        deletado
      `)
      .eq("ativo", true)
      .eq("deletado", false)
      .gte("created_at", periodo.inicioIso)
      .lte("created_at", periodo.fimIso);

  if (Array.isArray(empresasFiltro) && empresasFiltro.length > 0) {
    query =
      query.in("empresa", empresasFiltro);
  }

  const { data, error } =
    await query;

  if (error) {
    throw new Error(
      `Erro ao buscar tarefas: ${error.message}`
    );
  }

  return data || [];
}

/* ======================================================
AGRUPAR POR EMPRESA
====================================================== */

function agruparPorEmpresa(tarefas, empresasSolicitadas) {
  const mapa = {};

  const empresasBase =
    Array.isArray(empresasSolicitadas) && empresasSolicitadas.length > 0
      ? empresasSolicitadas
      : EMPRESAS_PADRAO;

  empresasBase.forEach(empresa => {
    mapa[empresa] = [];
  });

  tarefas.forEach(tarefa => {
    const empresa =
      String(tarefa.empresa || "").trim();

    if (!empresa) {
      return;
    }

    if (!mapa[empresa]) {
      mapa[empresa] = [];
    }

    mapa[empresa].push(tarefa);
  });

  return mapa;
}

/* ======================================================
ENVIAR TEMPLATE WHATSAPP
====================================================== */

async function enviarTemplateChecklist({
  telefone,
  empresa,
  percentualConcluidas,
  percentualNaoConcluidas
}) {
  const url =
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: telefone,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: {
        code: LANGUAGE_CODE
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: String(empresa)
            },
            {
              type: "text",
              text: String(percentualConcluidas)
            },
            {
              type: "text",
              text: String(percentualNaoConcluidas)
            }
          ]
        }
      ]
    }
  };

  const resposta =
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

  const retorno =
    await resposta.json();

  if (!resposta.ok) {
    return {
      ok: false,
      enviado: false,
      empresa,
      erro: "Erro ao enviar template",
      payload,
      retorno
    };
  }

  return {
    ok: true,
    enviado: true,
    empresa,
    retorno
  };
}

/* ======================================================
HANDLER
====================================================== */

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        erro: "Metodo nao permitido"
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        erro: "Supabase nao configurado"
      });
    }

    if (!TOKEN) {
      return res.status(500).json({
        ok: false,
        erro: "WHATSAPP_TOKEN nao configurado"
      });
    }

const {
  telefone,
  empresa,
  empresas,
  enviarSemTarefa = false
} = req.body || {};

    const telefoneLimpo =
      limparNumero(telefone);

    if (!telefoneLimpo) {
      return res.status(400).json({
        ok: false,
        enviado: false,
        erro: "Telefone nao informado"
      });
    }

    let listaEmpresas = [];

    if (Array.isArray(empresas) && empresas.length > 0) {
      listaEmpresas = empresas;
    } else if (empresa) {
      listaEmpresas = [empresa];
    } else {
      listaEmpresas = EMPRESAS_PADRAO;
    }

    listaEmpresas =
      [...new Set(
        listaEmpresas
          .map(e => String(e || "").trim())
          .filter(Boolean)
      )];

    const periodo =
      periodoOperacionalDiaAnterior();

    const tarefas =
      await buscarTarefasDiaAnterior(
        periodo,
        listaEmpresas
      );

    const tarefasPorEmpresa =
      agruparPorEmpresa(
        tarefas,
        listaEmpresas
      );

    const resultados = [];

    for (const empresaAtual of Object.keys(tarefasPorEmpresa)) {
      const tarefasEmpresa =
        tarefasPorEmpresa[empresaAtual] || [];

      if (!enviarSemTarefa && tarefasEmpresa.length === 0) {
        resultados.push({
          empresa: empresaAtual,
          ignorado: true,
          motivo: "Sem tarefas no período"
        });

        continue;
      }

      const resumo =
        montarResumoChecklist(tarefasEmpresa);

      const envio =
        await enviarTemplateChecklist({
          telefone: telefoneLimpo,
          empresa: empresaAtual,
          percentualConcluidas: resumo.percentualConcluidas,
          percentualNaoConcluidas: resumo.percentualNaoConcluidas
        });

      resultados.push({
        empresa: empresaAtual,
        resumo,
        envio
      });
    }

    const enviados =
      resultados.filter(r => r.envio?.ok).length;

    const falhas =
      resultados.filter(r => r.envio && !r.envio.ok).length;

    const ignorados =
      resultados.filter(r => r.ignorado).length;

    return res.status(200).json({
      ok: falhas === 0,
      enviado: enviados > 0,
      template: TEMPLATE_NAME,
      telefone: telefoneLimpo,
      periodo: {
        inicio: periodo.inicioIso,
        fim: periodo.fimIso
      },
      empresas: listaEmpresas,
      total_empresas: listaEmpresas.length,
      enviados,
      falhas,
      ignorados,
      resultados
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      ok: false,
      enviado: false,
      erro: error.message
    });
  }
}
